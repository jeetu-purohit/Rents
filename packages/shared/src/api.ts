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
