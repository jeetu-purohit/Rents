import type {
  ApiErrorDto,
  CancelListingTransactionRequest,
  CheckInTicketTransactionRequest,
  CreateEventRequest,
  CreateEventResponse,
  EventDto,
  EventListResponse,
  InitializeEventTransactionDto,
  InitializeEventTransactionRequest,
  ListTicketTransactionRequest,
  MintTicketTransactionDto,
  MintTicketTransactionRequest,
  PlatformConfigDto,
  ResellTicketTransactionRequest,
  TicketDto,
  TicketListResponse,
  TicketMetadataDto,
  UnsignedTransactionDto,
} from 'shared'
import { frontendConfig } from './config'

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

function isApiError(value: unknown): value is ApiErrorDto {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = value.error
  return typeof error === 'object' && error !== null &&
    'code' in error && typeof error.code === 'string' &&
    'message' in error && typeof error.message === 'string'
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${frontendConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const error = isApiError(body) ? body.error : undefined
    throw new ApiError(error?.message ?? 'The request could not be completed.', error?.code ?? 'REQUEST_ERROR', response.status)
  }
  return body as T
}

function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export const api = {
  getEvents: () => request<EventListResponse>('/events'),
  getEvent: (id: string) => request<EventDto>(`/events/${encodeURIComponent(id)}`),
  getEventsByOrganizer: (pubkey: string) => request<EventListResponse>(`/events/organizer/${encodeURIComponent(pubkey)}`),
  createEvent: (event: CreateEventRequest) => request<CreateEventResponse>('/events', { ...jsonBody(event), method: 'POST' }),
  getTicketsByOwner: (pubkey: string) => request<TicketListResponse>(`/tickets/owner/${encodeURIComponent(pubkey)}`),
  getTicketsByEvent: (eventPda: string) => request<TicketListResponse>(`/tickets/event/${encodeURIComponent(eventPda)}`),
  getTicket: (mint: string) => request<TicketDto>(`/tickets/${encodeURIComponent(mint)}`),
  getListings: () => request<TicketListResponse>('/tickets/listings'),
  syncTicket: (mint: string) => request<TicketDto>(`/tickets/${encodeURIComponent(mint)}/sync`, { method: 'POST' }),
  getPlatform: () => request<PlatformConfigDto>('/platform'),
  getMetadata: (mint: string) => request<TicketMetadataDto>(`/metadata/${encodeURIComponent(mint)}`),
  buildInitializeEvent: (input: InitializeEventTransactionRequest) =>
    request<InitializeEventTransactionDto>('/tx/initialize-event', jsonBody(input)),
  buildMintTicket: (input: MintTicketTransactionRequest) =>
    request<MintTicketTransactionDto>('/tx/mint', jsonBody(input)),
  buildListTicket: (input: ListTicketTransactionRequest) =>
    request<UnsignedTransactionDto>('/tx/list', jsonBody(input)),
  buildCancelListing: (input: CancelListingTransactionRequest) =>
    request<UnsignedTransactionDto>('/tx/cancel-listing', jsonBody(input)),
  buildResellTicket: (input: ResellTicketTransactionRequest) =>
    request<UnsignedTransactionDto>('/tx/resell', jsonBody(input)),
  buildCheckInTicket: (input: CheckInTicketTransactionRequest) =>
    request<UnsignedTransactionDto>('/tx/check-in', jsonBody(input)),
}
