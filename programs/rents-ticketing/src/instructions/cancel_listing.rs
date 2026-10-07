use crate::constants::TICKET_SEED;
use crate::error::RentsError;
use crate::state::Ticket;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct CancelListing<'info> {
    pub holder: Signer<'info>,

    #[account(
        mut,
        seeds = [TICKET_SEED, ticket.mint.as_ref()],
        bump = ticket.bump
    )]
    pub ticket: Account<'info, Ticket>,

    #[account(
        constraint = token_account.mint == ticket.mint @ RentsError::NotTicketHolder,
        constraint = token_account.owner == holder.key() @ RentsError::NotTicketHolder
    )]
    pub token_account: Account<'info, TokenAccount>,
}

pub fn handler(ctx: Context<CancelListing>) -> Result<()> {
    require!(
        ctx.accounts.token_account.amount == 1,
        RentsError::NotTicketHolder
    );
    ctx.accounts.ticket.listing_price = None;
    Ok(())
}
