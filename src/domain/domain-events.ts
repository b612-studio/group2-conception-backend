import type { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'
import type { DomainEvent } from '#/shared-kernel/event-bus.ts'

interface EventDetails {
  eventId: EventId
  title: string
  category: string
  startsAt: Date
  capacity: number
  venueId: VenueId
}

interface ReservationDetails {
  reservationId: ReservationId
  eventId: EventId
  userId: UserId
  quantity: number
}

interface EventContents {
  EventCreated: EventDetails
  EventUpdated: EventDetails
  EventReserved: ReservationDetails
  ReservationCancelled: ReservationDetails
  EventViewed: { eventId: EventId }
  EventsListed: { category?: string; after?: Date; count: number }
  ReservationsListed: { userId: UserId; count: number }
}

export type ApplicationEvent = {
  [Type in keyof EventContents]: DomainEvent & {
    readonly type: Type
    readonly content: EventContents[Type]
  }
}[keyof EventContents]

export function domainEvent<Type extends keyof EventContents>(
  type: Type,
  content: EventContents[Type],
  occurredAt: Date,
): DomainEvent & {
  readonly type: Type
  readonly content: EventContents[Type]
} {
  return { type, content, context: { occurredAt, version: 'v1' } }
}
