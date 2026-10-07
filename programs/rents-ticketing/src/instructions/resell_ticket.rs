use crate::constants::{
    AUTHORITY_SEED, BPS_DENOMINATOR, EVENT_SEED, PLATFORM_CONFIG_SEED, TICKET_SEED,
};
use crate::error::RentsError;
use crate::state::{Event, PlatformConfig, Ticket};
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Approve, FreezeAccount, Mint, ThawAccount, Token, TokenAccount};

#[derive(Accounts)]
pub struct ResellTicket<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        seeds = [EVENT_SEED, event.organizer.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump
    )]
    pub event: Account<'info, Event>,

    #[account(
        mut,
        seeds = [TICKET_SEED, ticket.mint.as_ref()],
        bump = ticket.bump,
        constraint = ticket.event == event.key() @ RentsError::WrongEvent
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(mut, address = event.organizer @ RentsError::InvalidOrganizer)]
    pub organizer: SystemAccount<'info>,

    #[account(mut)]
    pub seller: SystemAccount<'info>,

    #[account(seeds = [PLATFORM_CONFIG_SEED], bump = platform_config.bump)]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(mut, address = platform_config.platform_wallet)]
    pub platform_wallet: SystemAccount<'info>,

    /// CHECK: The PDA is seed-validated and signs only the token-authority CPIs in this flow.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub ticket_authority: UncheckedAccount<'info>,

    #[account(address = ticket.mint)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = seller,
        token::token_program = token_program
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        // Allow the same ATA key through account validation so the handler can return SelfPurchase.
        dup,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ResellTicket>) -> Result<()> {
    let ticket = &ctx.accounts.ticket;
    require!(!ticket.is_used, RentsError::TicketAlreadyUsed);
    require!(
        ctx.accounts.buyer.key() != ctx.accounts.seller.key(),
        RentsError::SelfPurchase
    );
    require!(
        ctx.accounts.seller_token_account.amount == 1,
        RentsError::NotTicketHolder
    );

    let price = ticket.listing_price.ok_or(error!(RentsError::NotListed))?;
    require!(price > 0, RentsError::InvalidPrice);

    let cap = u128::from(ticket.face_value)
        .checked_mul(u128::from(ctx.accounts.event.resale_cap_bps))
        .ok_or(RentsError::MathOverflow)?
        .checked_div(u128::from(BPS_DENOMINATOR))
        .ok_or(RentsError::MathOverflow)?;
    require!(u128::from(price) <= cap, RentsError::PriceExceedsCap);

    let royalty = calculate_bps_amount(price, ctx.accounts.event.royalty_bps)?;
    let fee = calculate_bps_amount(price, ctx.accounts.platform_config.platform_fee_bps)?;
    let seller_proceeds = u128::from(price)
        .checked_sub(u128::from(royalty))
        .ok_or(RentsError::MathOverflow)?;
    let buyer_total = u128::from(price)
        .checked_add(u128::from(fee))
        .ok_or(RentsError::MathOverflow)?;
    let seller_proceeds = u64::try_from(seller_proceeds).map_err(|_| RentsError::MathOverflow)?;
    let _buyer_total = u64::try_from(buyer_total).map_err(|_| RentsError::MathOverflow)?;
    let next_resale_count = ticket
        .resale_count
        .checked_add(1)
        .ok_or(RentsError::MathOverflow)?;

    let buyer_info = ctx.accounts.buyer.to_account_info();
    let payment_destinations = [
        (ctx.accounts.organizer.to_account_info(), royalty),
        (ctx.accounts.seller.to_account_info(), seller_proceeds),
        (ctx.accounts.platform_wallet.to_account_info(), fee),
    ];
    for (destination, amount) in payment_destinations {
        if amount == 0 {
            continue;
        }
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: buyer_info.clone(),
                    to: destination,
                },
            ),
            amount,
        )?;
    }

    let authority_bump = [ctx.bumps.ticket_authority];
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, &authority_bump];
    let signer_seeds: &[&[&[u8]]] = &[authority_seeds];
    token::thaw_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        ThawAccount {
            account: ctx.accounts.seller_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.ticket_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.seller_token_account.to_account_info(),
                to: ctx.accounts.buyer_token_account.to_account_info(),
                authority: ctx.accounts.ticket_authority.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    token::approve(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Approve {
                to: ctx.accounts.buyer_token_account.to_account_info(),
                delegate: ctx.accounts.ticket_authority.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        1,
    )?;

    token::freeze_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        FreezeAccount {
            account: ctx.accounts.buyer_token_account.to_account_info(),
            mint: ctx.accounts.mint.to_account_info(),
            authority: ctx.accounts.ticket_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    let ticket = &mut ctx.accounts.ticket;
    ticket.listing_price = None;
    ticket.resale_count = next_resale_count;
    Ok(())
}

fn calculate_bps_amount(amount: u64, basis_points: u16) -> Result<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(basis_points))
        .ok_or(RentsError::MathOverflow)?
        .checked_div(u128::from(BPS_DENOMINATOR))
        .ok_or(RentsError::MathOverflow)?;
    u64::try_from(value).map_err(|_| error!(RentsError::MathOverflow))
}
