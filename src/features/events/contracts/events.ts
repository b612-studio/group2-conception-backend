// Published facts use opaque references, not Events' domain-specific branded IDs.

interface EventDetails {
  readonly eventId: string
  readonly title: string
  readonly category: string
  readonly startsAt: Date
  readonly capacity: number
  readonly venueId: string
}

interface ReservationDetails {
  readonly reservationId: string
  readonly eventId: string
  readonly userId: string
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
