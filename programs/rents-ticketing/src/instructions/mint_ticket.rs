use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::constants::{BPS_DENOMINATOR, EVENT_SEED, PLATFORM_CONFIG_SEED, TICKET_SEED};
use crate::error::RentsError;
use crate::state::{Event, PlatformConfig, Ticket};

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

    #[account(
        init,
        payer = buyer,
        mint::decimals = 0,
        mint::authority = buyer,
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

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<MintTicket>, _uri: String) -> Result<()> {
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
