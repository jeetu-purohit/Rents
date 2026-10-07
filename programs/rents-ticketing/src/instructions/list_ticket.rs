use crate::constants::{BPS_DENOMINATOR, EVENT_SEED, TICKET_SEED};
use crate::error::RentsError;
use crate::state::{Event, Ticket};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct ListTicket<'info> {
    pub holder: Signer<'info>,

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

    #[account(
        constraint = token_account.mint == ticket.mint @ RentsError::NotTicketHolder,
        constraint = token_account.owner == holder.key() @ RentsError::NotTicketHolder
    )]
    pub token_account: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<ListTicket>, price: u64) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    require!(!ticket.is_used, RentsError::TicketAlreadyUsed);
    require!(
        ctx.accounts.token_account.amount == 1,
        RentsError::NotTicketHolder
    );
    require!(price > 0, RentsError::InvalidPrice);

    let cap = u128::from(ticket.face_value)
        .checked_mul(u128::from(ctx.accounts.event.resale_cap_bps))
        .ok_or(RentsError::MathOverflow)?
        .checked_div(u128::from(BPS_DENOMINATOR))
        .ok_or(RentsError::MathOverflow)?;
    require!(u128::from(price) <= cap, RentsError::PriceExceedsCap);

    ticket.listing_price = Some(price);
    Ok(())
}
