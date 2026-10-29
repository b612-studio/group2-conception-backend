import { Capacity } from '#/domain/capacity.ts'
import { Conflict, InvalidInput } from '#/domain/errors.ts'
import type { EventId, VenueId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'

export interface EventData {
  id: EventId
  title: string
  category: string
  startsAt: Date
  capacity: Capacity
  venueId: VenueId
}
export type EventInput = Omit<EventData, 'id' | 'capacity'> & {
  capacity: number
}
export type EventCreationData = EventInput & { id: EventId }

export class Event {
  private constructor(readonly data: Readonly<EventData>) {}

  static create(data: EventCreationData): Result<Event, InvalidInput> {
    if (!data.title.trim() || !data.category.trim()) {
      return Result.fail(
        new InvalidInput('Title and category must not be empty'),
      )
    }
    if (!Number.isFinite(data.startsAt.getTime())) {
      return Result.fail(new InvalidInput('Invalid start date'))
    }
    const capacity = Capacity.create(data.capacity)
    if (Result.isFailure(capacity)) {
      return capacity
    }
    return Result.succeed(new Event({ ...data, capacity: capacity.value }))
  }

  update(
    patch: Partial<EventInput>,
    reservedSeats: number,
    now: Date,
  ): Result<Event, Conflict | InvalidInput> {
    const result = Event.create({
      ...this.data,
      capacity: this.data.capacity.value,
      ...patch,
    })
    if (Result.isFailure(result)) {
      return result
    }
    const updated = result.value
    if (this.data.startsAt <= now || updated.data.startsAt <= now) {
      return Result.fail(new Conflict('Only future events can be updated'))
    }
    if (!updated.data.capacity.accommodates(reservedSeats)) {
      return Result.fail(
        new Conflict(
          'Capacity cannot be lower than the number of reserved seats',
        ),
      )
    }
    return Result.succeed(updated)
  }

  checkReservation(
    quantity: number,
    reservedSeats: number,
    now: Date,
  ): Result<void, InvalidInput | Conflict> {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      return Result.fail(
        new InvalidInput('Quantity must be a positive 32-bit integer'),
      )
    }
    if (this.data.startsAt <= now) {
      return Result.fail(new Conflict('Event has already started'))
    }
    if (!this.data.capacity.accommodates(reservedSeats + quantity)) {
      return Result.fail(new Conflict('Not enough seats'))
    }
    return Result.succeed(undefined)
  }
}
