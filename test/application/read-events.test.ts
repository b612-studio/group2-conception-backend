import { expect, test } from 'bun:test'
import { NotFound } from '#/domain/errors.ts'
import { EventId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  anApplication,
  anExistingEvent,
  anEventWithReservation,
} from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('getting an existing event returns its application value', () =>
  given(anExistingEvent)
    .when(({ services, event }) => services.read.get.execute(event.data.id))
    .then((result, { event }) => {
      expect(result).toEqual(Result.succeed(event))
    }))

test('a missing event is translated from Option.none to NotFound', () =>
  given(anApplication)
    .when(({ services }) => services.read.get.execute(EventId.make()))
    .then((result) => {
      expect(result).toEqual(Result.fail(new NotFound('Event not found')))
    }))

test('listing an empty application returns no events or reservations', () =>
  given(anApplication)
    .when(async ({ services, alice }) => ({
      events: await services.read.list.execute({}),
      reservations: await services.read.reservationsFor.execute(alice),
    }))
    .then(({ events, reservations }) => {
      expect(events).toEqual([])
      expect(reservations).toEqual([])
    }))

test('listing orders events by start time regardless of creation order', () =>
  given(async () => {
    const fixture = anApplication()
    const later = await fixture.createEvent({
      startsAt: new Date('2030-01-03T18:00:00Z'),
    })
    const earlier = await fixture.createEvent()
    return { ...fixture, later, earlier }
  })
    .when(({ services }) => services.read.list.execute({}))
    .then((events, { earlier, later }) => {
      expect(events).toEqual([earlier, later])
    }))

test('category and exclusive date filters apply together', () =>
  given(async () => {
    const fixture = await anExistingEvent()
    const later = await fixture.createEvent({
      startsAt: new Date('2030-01-03T18:00:00Z'),
    })
    await fixture.createEvent({
      category: 'music',
      startsAt: new Date('2030-01-04T18:00:00Z'),
    })
    return { ...fixture, later }
  })
    .when(async ({ services, event }) => ({
      filtered: await services.read.list.execute({
        category: 'gaming',
        after: event.data.startsAt,
      }),
      unrelated: await services.read.list.execute({ category: 'missing' }),
    }))
    .then(({ filtered, unrelated }, { later }) => {
      expect(filtered).toEqual([later])
      expect(unrelated).toEqual([])
    }))

test('reservations are scoped to their owner and include cancelled bookings', () =>
  given(async () => {
    const fixture = await anEventWithReservation()
    const cancelled = Result.getOrThrow(
      await fixture.services.cancel.execute({
        id: fixture.reservation.data.id,
        userId: fixture.alice,
      }),
    )
    return { ...fixture, cancelled }
  })
    .when(async ({ services, alice, bob }) => ({
      owned: await services.read.reservationsFor.execute(alice),
      other: await services.read.reservationsFor.execute(bob),
    }))
    .then(({ owned, other }, { cancelled }) => {
      expect(owned).toEqual([cancelled])
      expect(other).toEqual([])
    }))
