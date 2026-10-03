export interface EventDto {
  _id: string;
  onChainEventId: string;
  organizerPubkey: string;
  eventPda: string;
  name: string;
  description: string;
  venue: string;
  date: string;
  imageUrl?: string;
  maxTickets: number;
  basePriceLamports: string;
  resaleCapBps: number;
  royaltyBps: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateEventRequest = Omit<EventDto, "_id" | "createdAt" | "updatedAt">;
export type CreateEventResponse = EventDto;
export type UpdateEventRequest = Partial<CreateEventRequest>;
export type EventListResponse = EventDto[];

export interface TicketDto {
  _id: string;
  mintAddress: string;
  ticketPda: string;
  eventPda: string;
  ownerPubkey: string;
  faceValueLamports: string;
  listingPriceLamports?: string;
  isCheckedIn: boolean;
  checkedInAt?: string;
  resaleCount: number;
  lastSyncedAt: string;
}

export type TicketListResponse = TicketDto[];

export interface UserDto {
  _id: string;
  pubkey: string;
  isOrganizer: boolean;
  displayName?: string;
}

export interface PlatformConfigDto {
  platformFeeBps: number;
  platformWallet: string;
}

export interface TicketMetadataDto {
  name: string;
  symbol: "RENTS";
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string }>;
}

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
  };
}

export interface UnsignedTransactionDto {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface InitializeEventTransactionDto extends UnsignedTransactionDto {
  eventPda: string;
}

export interface MintTicketTransactionDto extends UnsignedTransactionDto {
  ticketPda: string;
}

export interface InitializeEventTransactionRequest {
  organizerPubkey: string;
  eventId: string;
  maxTickets: number;
  basePriceLamports: string;
  resaleCapBps: number;
  royaltyBps: number;
}

export interface MintTicketTransactionRequest {
  buyerPubkey: string;
  eventPda: string;
  mintPubkey: string;
  eventName: string;
  uri: string;
}

export interface ListTicketTransactionRequest {
  holderPubkey: string;
  mintPubkey: string;
  priceLamports: string;
}

export interface CancelListingTransactionRequest {
  holderPubkey: string;
  mintPubkey: string;
}

export interface ResellTicketTransactionRequest {
  buyerPubkey: string;
  sellerPubkey: string;
  mintPubkey: string;
}

export interface CheckInTicketTransactionRequest {
  organizerPubkey: string;
  holderPubkey: string;
  mintPubkey: string;
}
