use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("E92DmfyvMfLBWs9TqzFzN11khwxopKEvCKPoD3jY9zhw");

#[program]
pub mod rents_ticketing {

    use super::*;

    //organizer setup the event using this function call , they set the max tickets , base price , resale cap % and royalty % they want on every resale.
    pub fn initialize_event(
        ctx: Context<InitializeEvent>,
        event_id: u64,
        max_tickets: u32,
        base_price: u64,
        resale_cap_bps: u16,
        royalty_bps: u16,
    ) -> Result<()> {
        instructions::initialize_event::handler(
            ctx,
            event_id,
            max_tickets,
            base_price,
            resale_cap_bps,
            royalty_bps,
        )
    }

    pub fn initialize_platform_config(
        ctx: Context<InitializePlatformConfig>,
        platform_wallet: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        instructions::initialize_platform_config::handler(ctx, platform_wallet, platform_fee_bps)
    }

    pub fn update_platform_wallet(
        ctx: Context<UpdatePlatformWallet>,
        new_platform_wallet: Pubkey,
    ) -> Result<()> {
        instructions::update_platform_wallet::handler(ctx, new_platform_wallet)
    }

    pub fn update_platform_fee(ctx: Context<UpdatePlatformFee>, new_fee_bps: u16) -> Result<()> {
        instructions::update_platform_fee::handler(ctx, new_fee_bps)
    }

    //finished writing till here

    //function that creates a nft ticket to a buyers wallet using the metaplex CPI.
    // the users buy the ticket using there wallet and that 95% of that money goes directly to the organizers wallet and the rest 5% goes to our fat wallet as the platform charges.Same with the royalty.
    pub fn mint_ticket(ctx: Context<MintTicket>, event_name: String, uri: String) -> Result<()> {
        instructions::mint_ticket::handler(ctx, event_name, uri)
    }

    pub fn list_ticket(ctx: Context<ListTicket>, price: u64) -> Result<()> {
        instructions::list_ticket::handler(ctx, price)
    }

    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        instructions::cancel_listing::handler(ctx)
    }

    //transfer ticket to new buyer and enforces a price cap , and split the royalty with the organizer and to my fat wallet.
    pub fn resell_ticket(ctx: Context<ResellTicket>) -> Result<()> {
        instructions::resell_ticket::handler(ctx)
    }

    //this function is called when a person does a qr checkin , checks if the ticket is present on the blockchain and check if it is already scanned or not.
    pub fn check_in_ticket(ctx: Context<CheckInTicket>) -> Result<()> {
        //rejects the ticket if it is market true else mark it true after scanning.
        Ok(())
    }
}
