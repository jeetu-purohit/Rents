use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct MintTicket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
}
pub fn handler(ctx: Context<MintTicket>) -> Result<()> {
    Ok(())
}
