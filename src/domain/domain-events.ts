import type { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'

interface EventDetails {
  readonly eventId: EventId
  readonly title: string
  readonly category: string
  readonly startsAt: Date
  readonly capacity: number
  readonly venueId: VenueId
}

interface ReservationDetails {
  readonly reservationId: ReservationId
  readonly eventId: EventId
  readonly userId: UserId
  readonly quantity: number
}

export interface EventCreated {
  readonly type: 'EventCreated'
  readonly content: EventDetails
}

export interface EventUpdated {
  readonly type: 'EventUpdated'
  readonly content: EventDetails
}

export interface EventReserved {
  readonly type: 'EventReserved'
  readonly content: ReservationDetails
}

export interface ReservationCancelled {
  readonly type: 'ReservationCancelled'
  readonly content: ReservationDetails
}

export type DomainEvent =
  | EventCreated
  | EventUpdated
  | EventReserved
  | ReservationCancelled
