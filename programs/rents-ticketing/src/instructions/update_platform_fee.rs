use anchor_lang::prelude::*;

use crate::constants::{MAX_PLATFORM_FEE_BPS, PLATFORM_CONFIG_SEED};
use crate::error::RentsError;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct UpdatePlatformFee<'info> {
    pub admin: Signer<'info>,

    #[account(
    mut,
    seeds = [PLATFORM_CONFIG_SEED],
    bump = platform_config.bump,
    has_one = admin @ RentsError::NotAdmin
  )]
    pub platform_config: Account<'info, PlatformConfig>,
}

pub fn handler(ctx: Context<UpdatePlatformFee>, new_fee_bps: u16) -> Result<()> {
    require!(new_fee_bps <= MAX_PLATFORM_FEE_BPS, RentsError::InvalidFee);
    ctx.accounts.platform_config.platform_fee_bps = new_fee_bps;
    Ok(())
}
