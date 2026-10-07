use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Event {
    pub organizer: Pubkey,
    pub event_id: u64,
    pub max_tickets: u32,
    pub tickets_sold: u32,
    pub base_price: u64,
    pub resale_cap_bps: u16,
    pub royalty_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub event: Pubkey,
    pub mint: Pubkey,
    pub ticket_number: u32,
    pub face_value: u64,
    pub is_used: bool,
    pub used_at: i64,
    pub listing_price: Option<u64>,
    pub resale_count: u16,
    pub bump: u8,
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
