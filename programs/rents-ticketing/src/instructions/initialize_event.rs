use anchor_lang::prelude::*;

use crate::constants::EVENT_SEED;
use crate::state::Event;

#[derive(Accounts)]
pub struct InitializeEvent<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
    init,
    payer = organizer,
    space = 8 + Event::INIT_SPACE,
    seeds = [EVENT_SEED, organizer.key().as_ref()],
    bump
  )]
    pub event: Account<'info, Event>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeEvent>,
    max_tickets: u32,
    base_price_lamports: u64,
    resale_cap_percent: u16,
    royalty_percent: u16,
) -> Result<()> {
    let event = &mut ctx.accounts.event;

    event.organizer = ctx.accounts.organizer.key();
    event.max_tickets = max_tickets;
    event.tickets_sold = 0;
    event.base_price = base_price_lamports;
    event.resale_cap_bps = resale_cap_percent;
    event.royalty_bps = royalty_percent;
    event.bump = ctx.bumps.event;
    Ok(())
}
