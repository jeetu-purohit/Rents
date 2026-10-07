use crate::constants::{EVENT_SEED, TICKET_SEED};
use crate::error::RentsError;
use crate::state::{Event, Ticket};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct CheckInTicket<'info> {
    #[account(address = event.organizer @ RentsError::NotEventOrganizer)]
    pub organizer: Signer<'info>,

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

    #[account(address = ticket.mint)]
    pub mint: Account<'info, Mint>,

    /// CHECK: Used only to verify the token account's SPL authority.
    pub holder: UncheckedAccount<'info>,

    #[account(
        token::mint = mint,
        token::authority = holder,
        token::token_program = token_program
    )]
    pub token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CheckInTicket>) -> Result<()> {
    require!(!ctx.accounts.ticket.is_used, RentsError::TicketAlreadyUsed);
    require!(
        ctx.accounts.token_account.amount == 1,
        RentsError::NotTicketHolder
    );

    let used_at = Clock::get()?.unix_timestamp;
    let ticket = &mut ctx.accounts.ticket;
    ticket.is_used = true;
    ticket.used_at = used_at;
    Ok(())
}
