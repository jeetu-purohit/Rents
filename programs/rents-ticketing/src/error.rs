use anchor_lang::prelude::*;

#[error_code]
pub enum RentsError {
  #[msg("Resale price exceeds the allowed cap.")]
  PriceExceedsCap,
  #[msg("Ticket has already been checked in")]
  AlreadyCheckedIn,
  #[msg("Event has sold out.")]
  SoldOut,
  #[msg("Provided organizer does not match the events organizer.")]
  InvalidOrganizer,
  #[msg("Arithmetic overflow while computing fees.")]
  MathOverFlow,
  #[msg("Only the platform config authority can perform this action.")]
  Unauthorized,
  #[msg("Provided seller is not the current owner of this ticket.")]
  NotTicketOwner,
}