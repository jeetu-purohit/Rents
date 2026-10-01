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
    max_tickets: u32,
    base_price_lamports: u64,
    resale_cap_percent: u16,
    royalty_percent : u16,
  ) -> Result<()>{
    instructions::initialize_event::handler(
      ctx,
      max_tickets,
      base_price_lamports,
      resale_cap_percent,
      royalty_percent,
    )
  }


  pub fn initialize_platform_config(
    ctx: Context<InitializePlatformConfig>,
    platform_wallet: Pubkey,
  )-> Result<()>{
    instructions::initialize_platform_config::handler(ctx, platform_wallet)
  }

  pub fn update_platform_wallet (
    ctx: Context<Update_platform_wallet>,
    new_platform_wallet: Pubkey,
  ) -> Result<()> {
    instructios::update_platform_wallet::handler(ctx , new_platform_wallet)
  }

  //finished writing till here 
  
  //function that creates a nft ticket to a buyers wallet using the metaplex CPI.
  // the users buy the ticket using there wallet and that 95% of that money goes directly to the organizers wallet and the rest 5% goes to our fat wallet as the platform charges.Same with the royalty.  
  pub fn mint_ticket(ctx: Context<MintTicket>) -> Result<()>{
    Ok(())
  }
  
  //transfer ticket to new buyer and enforces a price cap , and split the royalty with the organizer and to my fat wallet.
  pub fn resell_ticket(ctx:Context<ResellTicket>,sale_price_lamports:u64) -> Result<()> {
      Ok(())
  }

  //this function is called when a person does a qr checkin , checks if the ticket is present on the blockchain and check if it is already scanned or not.
  pub fn check_in_ticket(ctx: Context<CheckInTicket>)-> Result<()> {
    //rejects the ticket if it is market true else mark it true after scanning.
    Ok(())
  }
}