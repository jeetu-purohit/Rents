use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct CheckInTicket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
}
pub fn handler(ctx: Context<CheckInTicket>) -> Result<()> {
    Ok(())
}
