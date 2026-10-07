use crate::constants::{
    AUTHORITY_SEED, BPS_DENOMINATOR, EVENT_SEED, PLATFORM_CONFIG_SEED, TICKET_SEED,
};
use crate::error::RentsError;
use crate::state::{Event, PlatformConfig, Ticket};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount};
use mpl_token_metadata::instructions::{
    CreateMetadataAccountV3, CreateMetadataAccountV3InstructionArgs,
};
use mpl_token_metadata::types::{Creator, DataV2};

const TOKEN_METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

#[derive(Accounts)]
pub struct MintTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [EVENT_SEED, event.organizer.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump
    )]
    pub event: Account<'info, Event>,

    #[account(mut, address = event.organizer @ RentsError::InvalidOrganizer)]
    pub organizer: SystemAccount<'info>,

    #[account(seeds = [PLATFORM_CONFIG_SEED], bump = platform_config.bump)]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut, address = platform_config.platform_wallet)]
    pub platform_wallet: SystemAccount<'info>,

    /// CHECK: This PDA is the only program-authorized mint freeze authority and delegate.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = buyer,
        mint::freeze_authority = ticket_authority,
        token::token_program = token_program
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [TICKET_SEED, mint.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: Validated as the Metaplex metadata PDA for this mint and program below.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = TOKEN_METADATA_PROGRAM_ID
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: The address constraint pins this to the installed Token Metadata program.
    #[account(address = TOKEN_METADATA_PROGRAM_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintTicket>, event_name: String, uri: String) -> Result<()> {
    let event = &ctx.accounts.event;
    require!(event.tickets_sold < event.max_tickets, RentsError::SoldOut);

    let next_ticket_number = event
        .tickets_sold
        .checked_add(1)
        .ok_or(RentsError::MathOverflow)?;
    let fee = u128::from(event.base_price)
        .checked_mul(u128::from(ctx.accounts.platform_config.platform_fee_bps))
        .ok_or(RentsError::MathOverflow)?
        .checked_div(u128::from(BPS_DENOMINATOR))
        .ok_or(RentsError::MathOverflow)?;
    let fee = u64::try_from(fee).map_err(|_| RentsError::MathOverflow)?;

    if event.base_price > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.organizer.to_account_info(),
                },
            ),
            event.base_price,
        )?;
    }
    if fee > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.platform_wallet.to_account_info(),
                },
            ),
            fee,
        )?;
    }

    token::mint_to(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        1,
    )?;

    let metadata_program_info = ctx.accounts.token_metadata_program.to_account_info();
    let metadata_info = ctx.accounts.metadata.to_account_info();
    let mint_info = ctx.accounts.mint.to_account_info();
    let buyer_info = ctx.accounts.buyer.to_account_info();
    let organizer_info = ctx.accounts.organizer.to_account_info();
    let system_program_info = ctx.accounts.system_program.to_account_info();
    let metadata_name = format!("{event_name} #{next_ticket_number}");
    let mpl_metadata_instruction = CreateMetadataAccountV3 {
        metadata: ctx.accounts.metadata.key().to_bytes().into(),
        mint: ctx.accounts.mint.key().to_bytes().into(),
        mint_authority: ctx.accounts.buyer.key().to_bytes().into(),
        payer: ctx.accounts.buyer.key().to_bytes().into(),
        update_authority: (ctx.accounts.organizer.key().to_bytes().into(), false),
        rent: None,
        system_program: ctx.accounts.system_program.key().to_bytes().into(),
    }
    .instruction(CreateMetadataAccountV3InstructionArgs {
        data: DataV2 {
            name: metadata_name,
            symbol: "RENTS".to_string(),
            uri,
            seller_fee_basis_points: ctx.accounts.event.royalty_bps,
            creators: Some(vec![Creator {
                address: ctx.accounts.event.organizer.to_bytes().into(),
                verified: false,
                share: 100,
            }]),
            collection: None,
            uses: None,
        },
        is_mutable: false,
        collection_details: None,
    });
    let metadata_instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: Pubkey::new_from_array(mpl_metadata_instruction.program_id.to_bytes()),
        accounts: mpl_metadata_instruction
            .accounts
            .into_iter()
            .map(|account| {
                let pubkey = Pubkey::new_from_array(account.pubkey.to_bytes());
                if account.is_writable {
                    anchor_lang::solana_program::instruction::AccountMeta::new(
                        pubkey,
                        account.is_signer,
                    )
                } else {
                    anchor_lang::solana_program::instruction::AccountMeta::new_readonly(
                        pubkey,
                        account.is_signer,
                    )
                }
            })
            .collect(),
        data: mpl_metadata_instruction.data,
    };
    anchor_lang::solana_program::program::invoke_signed(
        &metadata_instruction,
        &[
            metadata_info,
            mint_info,
            buyer_info.clone(),
            buyer_info,
            organizer_info,
            system_program_info,
            metadata_program_info,
        ],
        &[],
    )?;

    token::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            SetAuthority {
                account_or_mint: ctx.accounts.mint.to_account_info(),
                current_authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        anchor_spl::token::spl_token::instruction::AuthorityType::MintTokens,
        None,
    )?;

    token::approve(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Approve {
                to: ctx.accounts.buyer_token_account.to_account_info(),
                delegate: ctx.accounts.ticket_authority.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        1,
    )?;

    let authority_bump = [ctx.bumps.ticket_authority];
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];
    token::freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        token::FreezeAccount {
            account: ctx.accounts.buyer_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.ticket_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    let event = &mut ctx.accounts.event;
    let ticket = &mut ctx.accounts.ticket;
    ticket.event = event.key();
    ticket.mint = ctx.accounts.mint.key();
    ticket.ticket_number = next_ticket_number;
    ticket.face_value = event.base_price;
    ticket.is_used = false;
    ticket.used_at = 0;
    ticket.listing_price = None;
    ticket.resale_count = 0;
    ticket.bump = ctx.bumps.ticket;
    event.tickets_sold = next_ticket_number;

    Ok(())
}
