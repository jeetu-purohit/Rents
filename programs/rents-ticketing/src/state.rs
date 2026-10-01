use anchor_lang::prelude::*;

#[account]
pub struct Event {
    pub organizer: Pubkey,
    pub max_tickets: u32,
    pub tickets_minted: u32,
    pub base_price_lamports: u64,
    pub resale_cap_percent: u16,
    pub royalty_percent: u16,
    pub bump: u8,
}

impl Event {
    pub const SIZE: usize = 8 + 32 + 4 + 4 + 8 + 2 + 2 + 1;
}

#[account]
pub struct PlatformConfig {
    pub admin: Pubkey,
    pub platform_wallet: Pubkey,
    pub platform_fee_bps: u16,
    pub bump: u8,
}

impl PlatformConfig {
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 1;
}
