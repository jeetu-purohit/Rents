pub const EVENT_SEED: &[u8] = b"event";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const PLATFORM_CONFIG_SEED: &[u8] = b"platform_config";

pub const DEFAULT_RESALE_CAP_PERCENT: u16 = 110;
pub const DEFAULT_ROYALTY_PERCENT: u16 = 5;

pub const PLATFORM_MINT_FEE_PERCENT: u64 = 5;//fee charged to buyer on top of the base_value 

pub const PLATFORM_ROYALTY_CUT_PRECENT: u64 = 10;//cut the platform takes from the organizers royalty for resell.