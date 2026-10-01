use anchor_lang::prelude::*;
#[derive(Accounts)]
pub struct ResellTicket<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
}
pub fn handler(ctx: Context<ResellTicket>, sale_price_lamports: u64) -> Result<()> {
    Ok(())
}
