use anchor_lang::prelude::*;

use crate::constants::PLATFORM_CONFIG_SEED;
use crate::error::RentsError;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct UpdatePlatformWallet<'info> {
  pub authority: Signer<'info>,

  #[account(
    mut,
    seeds = [PLATFORM_CONFIG_SEED],
    bump = platfrom_config.bump,
    has_one = authority @ RentsError::Unauthorized
  )]
  pub pltform_config: Account<'info, PlatformConfig>
}

pub fn handler(cts:Context<UpdatePlatformWallet>,new_platform_wallet) -> Result<()>{
  cts.accounts.pltform_config.platform_wallet = new_platform_wallet;
  Ok(())
}