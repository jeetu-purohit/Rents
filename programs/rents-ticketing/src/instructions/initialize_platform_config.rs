use anchor_lang::prelude::*;

use crate::constants::PLATFORM_CONFIG_SEED;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct InitializePlatformConfig<'info> {
  #[account(mut)]
  pub authority: Signer<'info>, 

  #[account(
    init, 
    payer = authority,
    space = PlatformConfig::SIZE,
    seeds = [PLATFORM_CONFIG_SEED],
    bump
  )]
  pub platform_config: Account<'info,PlatformConfig>,

  pub system_program: Program<'info, System>,
}

pub fn handler(ctx:Context<InitializePlatformConfig>,platform_wallet:Pubkey) -> Result<()> {
  let config = &mut ctx.accounts.platform_config;
  config.authority = ctx.accounts.authority.key();
  config.platform_wallet = platform_wallet;
  config.bump = ctx.bumps.platform_config;
  Ok(())
}