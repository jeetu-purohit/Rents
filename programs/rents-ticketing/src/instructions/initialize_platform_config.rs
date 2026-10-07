use anchor_lang::prelude::*;

use crate::constants::MAX_PLATFORM_FEE_BPS;
use crate::constants::PLATFORM_CONFIG_SEED;
use crate::error::RentsError;
use crate::state::PlatformConfig;

#[derive(Accounts)]
#[instruction(platform_wallet: Pubkey, platform_fee_bps: u16)]
pub struct InitializePlatformConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
    init,
    payer = admin,
    space = PlatformConfig::SIZE,
    seeds = [PLATFORM_CONFIG_SEED],
    bump,
    constraint = platform_fee_bps <= MAX_PLATFORM_FEE_BPS @ RentsError::InvalidFee
  )]
    pub platform_config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePlatformConfig>,
    platform_wallet: Pubkey,
    platform_fee_bps: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.platform_config;
    config.admin = ctx.accounts.admin.key();
    config.platform_wallet = platform_wallet;
    config.platform_fee_bps = platform_fee_bps;
    config.bump = ctx.bumps.platform_config;
    Ok(())
}
