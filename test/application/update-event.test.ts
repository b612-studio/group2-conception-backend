import { expect, test } from 'bun:test'
import { Conflict, InvalidInput, NotFound } from '#/domain/errors.ts'
import { EventId, VenueId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  anApplication,
  anExistingEvent,
  anEventWithReservation,
} from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('partial updates preserve the ID and unspecified fields', () =>
  given(anExistingEvent)
    .when(({ services, event }) =>
      services.update.execute({
        id: event.data.id,
        patch: { title: 'New title' },
      }),
    )
    .then(async (result, { services, event }) => {
      const updated = Result.getOrThrow(result)
      expect(updated.data).toEqual({ ...event.data, title: 'New title' })
      expect(await services.read.get.execute(event.data.id)).toEqual(
        Result.succeed(updated),
      )
    }))

test('updating a missing event returns NotFound', () =>
  given(anApplication)
    .when(({ services }) =>
      services.update.execute({ id: EventId.make(), patch: { capacity: 2 } }),
    )
    .then((result) => {
      expect(result).toEqual(Result.fail(new NotFound('Event not found')))
    }))

test('capacity cannot drop below reserved seats and failed updates persist nothing', () =>
  given(anEventWithReservation)
    .when(({ services, event }) =>
      services.update.execute({
        id: event.data.id,
        patch: {
          capacity: 1,
          title: 'Must not be saved',
        },
      }),
    )
    .then(async (result, { services, event }) => {
      expect(result).toEqual(
        Result.fail(
          new Conflict(
            'Capacity cannot be lower than the number of reserved seats',
          ),
        ),
      )
      expect(await services.read.get.execute(event.data.id)).toEqual(
        Result.succeed(event),
      )
    }))

test('capacity may equal the number of reserved seats', () =>
  given(async () => {
    const fixture = await anEventWithReservation()
    Result.getOrThrow(
      await fixture.services.update.execute({
        id: fixture.event.data.id,
        patch: {
          capacity: 3,
        },
      }),
    )
    return fixture
  })
    .when(({ services, event }) =>
      services.update.execute({ id: event.data.id, patch: { capacity: 2 } }),
    )
    .then(async (result, { services, event }) => {
      expect(Result.getOrThrow(result).data.capacity.value).toBe(2)
      expect(await services.read.get.execute(event.data.id)).toEqual(result)
    }))

test('updates use the current clock and reject an event at its start', () =>
  given(async () => {
    const fixture = await anExistingEvent()
    fixture.advanceTo(fixture.event.data.startsAt)
    return fixture
  })
    .when(({ services, event }) =>
      services.update.execute({
        id: event.data.id,
        patch: { title: 'Too late' },
      }),
    )
    .then(async (result, { services, event }) => {
      expect(result).toEqual(
        Result.fail(new Conflict('Only future events can be updated')),
      )
      expect(await services.read.get.execute(event.data.id)).toEqual(
        Result.succeed(event),
      )
    }))

test('rescheduling an event to the present is rejected', () =>
  given(anExistingEvent)
    .when(({ services, event }) =>
      services.update.execute({
        id: event.data.id,
        patch: {
          startsAt: new Date('2030-01-01T00:00:00Z'),
        },
      }),
    )
    .then(async (result, { services, event }) => {
      expect(result).toEqual(
        Result.fail(new Conflict('Only future events can be updated')),
      )
      expect(await services.read.get.execute(event.data.id)).toEqual(
        Result.succeed(event),
      )
    }))

test.each([{ capacity: 0 }, { venueId: VenueId.make() }])(
  'invalid updates leave the event unchanged: %j',
  (patch) =>
    given(anExistingEvent)
      .when(({ services, event }) =>
        services.update.execute({ id: event.data.id, patch }),
      )
      .then(async (result, { services, event }) => {
        expect(result).toMatchObject({
          _tag: 'Failure',
          error: expect.any(InvalidInput),
        })
        expect(await services.read.get.execute(event.data.id)).toEqual(
          Result.succeed(event),
        )
      }),
)
