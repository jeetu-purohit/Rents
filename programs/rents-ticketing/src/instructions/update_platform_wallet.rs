use anchor_lang::prelude::*;

use crate::constants::PLATFORM_CONFIG_SEED;
use crate::error::RentsError;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
    pub admin: Signer<'info>,

    #[account(
    mut,
    seeds = [PLATFORM_CONFIG_SEED],
    bump = platform_config.bump,
    has_one = admin @ RentsError::NotAdmin
  )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler(ctx: Context<UpdatePlatformWallet>, new_platform_wallet: Pubkey) -> Result<()> {
    ctx.accounts.platform_config.platform_wallet = new_platform_wallet;
    Ok(())
}
