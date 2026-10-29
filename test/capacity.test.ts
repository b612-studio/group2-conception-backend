import { expect, test } from 'bun:test'
import { Capacity } from '#/features/events/domain/capacity.ts'
import { Event } from '#/features/events/domain/event.ts'
import { InvalidInput } from '#/features/events/domain/errors.ts'
import { EventId, VenueId } from '#/features/events/domain/ids.ts'
import {
  eventToDomain,
  eventToEntity,
} from '#/features/events/infrastructure/event-entity.ts'
import { presentEvent } from '#/features/events/presentation/event-presenter.ts'
import { Result } from '#/shared-kernel/result.ts'

const invalidCapacities = [0, -1, 1.5, 2147483648, NaN, Infinity, -Infinity]

test.each(invalidCapacities)('capacity rejects %s as a value', (value) => {
  expect(Capacity.create(value)).toEqual(
    Result.fail(new InvalidInput('Capacity must be a positive 32-bit integer')),
  )
})

test.each([1, 2147483647])('capacity accepts the boundary %s', (value) => {
  const capacity = Result.getOrThrow(Capacity.create(value))
  expect(capacity.value).toBe(value)
  expect(capacity.accommodates(value)).toBe(true)
  expect(capacity.accommodates(value + 1)).toBe(false)
})

test('capacity equality compares values, not object identity', () => {
  const first = Result.getOrThrow(Capacity.create(10))
  const same = Result.getOrThrow(Capacity.create(10))
  const different = Result.getOrThrow(Capacity.create(11))
  expect(first).not.toBe(same)
  expect(first.equals(same)).toBe(true)
  expect(first.equals(different)).toBe(false)
})

test.each(invalidCapacities)(
  'event construction rejects capacity %s',
  (capacity) => {
    expect(
      Event.create({
        id: EventId.make(),
        title: 'Game night',
        category: 'gaming',
        startsAt: new Date('2099-01-01T18:00:00Z'),
        capacity,
        venueId: VenueId.make(),
      }),
    ).toEqual(
      Result.fail(
        new InvalidInput('Capacity must be a positive 32-bit integer'),
      ),
    )
  },
)

test('capacity remains numeric in database rows and public responses', () => {
  const row = {
    id: EventId.make(),
    title: 'Game night',
    category: 'gaming',
    starts_at: new Date('2099-01-01T18:00:00Z'),
    capacity: 10,
    venue_id: VenueId.make(),
  }
  const event = eventToDomain(row)
  expect(event.data.capacity).toBeInstanceOf(Capacity)
  expect(eventToEntity(event)).toEqual(row)
  expect(presentEvent(event).capacity).toBe(10)
})
