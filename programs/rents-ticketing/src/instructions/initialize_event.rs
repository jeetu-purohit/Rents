use anchor_lang::prelude::*;

use crate::constants::{BPS_DENOMINATOR, EVENT_SEED, MAX_ROYALTY_BPS};
use crate::error::RentsError;
use crate::state::Event;

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct InitializeEvent<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
    init,
    payer = organizer,
    space = 8 + Event::INIT_SPACE,
    seeds = [EVENT_SEED, organizer.key().as_ref(), &event_id.to_le_bytes()],
    bump
  )]
    pub event: Account<'info, Event>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeEvent>,
    event_id: u64,
    max_tickets: u32,
    base_price: u64,
    resale_cap_bps: u16,
    royalty_bps: u16,
) -> Result<()> {
    require!(resale_cap_bps >= BPS_DENOMINATOR, RentsError::InvalidBps);
    require!(royalty_bps <= MAX_ROYALTY_BPS, RentsError::InvalidBps);
    require!(max_tickets > 0, RentsError::InvalidMaxTickets);

    let event = &mut ctx.accounts.event;

    event.organizer = ctx.accounts.organizer.key();
    event.event_id = event_id;
    event.max_tickets = max_tickets;
    event.tickets_sold = 0;
    event.base_price = base_price;
    event.resale_cap_bps = resale_cap_bps;
    event.royalty_bps = royalty_bps;
    event.bump = ctx.bumps.event;
    Ok(())
}
