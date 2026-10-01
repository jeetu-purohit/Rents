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
    #[msg("Only the platform config admin can perform this action.")]
    NotAdmin,
    #[msg("Platform fee cannot exceed 500 basis points.")]
    InvalidFee,
    #[msg("Provided seller is not the current owner of this ticket.")]
    NotTicketOwner,
    #[msg("Invalid basis-point value.")]
    InvalidBps,
    #[msg("Price must be greater than zero.")]
    InvalidPrice,
    #[msg("Ticket is not listed for resale.")]
    NotListed,
    #[msg("Ticket has already been used.")]
    TicketAlreadyUsed,
    #[msg("Signer is not the current ticket holder.")]
    NotTicketHolder,
    #[msg("Signer is not the event organizer.")]
    NotEventOrganizer,
    #[msg("Ticket cannot be purchased by its current owner.")]
    SelfPurchase,
    #[msg("Arithmetic overflow while computing values.")]
    MathOverflow,
    #[msg("Ticket does not belong to the specified event.")]
    WrongEvent,
    #[msg("Maximum ticket count must be greater than zero.")]
    InvalidMaxTickets,
}
