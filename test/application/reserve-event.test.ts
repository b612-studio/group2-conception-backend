import { expect, test } from 'bun:test'
import { Conflict, InvalidInput, NotFound } from '#/domain/errors.ts'
import { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  anApplication,
  anExistingEvent,
  anEventWithReservation,
} from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('reserving persists the quantity, owner, generated ID and clock timestamp', () =>
  given(() => anExistingEvent({ capacity: 3 }))
    .when(({ services, event, alice }) =>
      services.reserve.execute({
        eventId: event.data.id,
        userId: alice,
        quantity: 2,
      }),
    )
    .then(async (result, { services, event, alice }) => {
      const reservation = Result.getOrThrow(result)
      expect(ReservationId.parse(reservation.data.id)).toEqual(
        Result.succeed(reservation.data.id),
      )
      expect(reservation.data).toEqual({
        id: reservation.data.id,
        eventId: event.data.id,
        userId: alice,
        quantity: 2,
        createdAt: new Date('2030-01-01T00:00:00Z'),
        cancelledAt: Option.none(),
      })
      const candidate = await services.read.reservationsFor.execute(alice)
      expect(candidate).toEqual([reservation])
    }))

test('competing reservations cannot both claim the last seat', () =>
  given(anExistingEvent)
    .when(({ services, event, alice, bob }) =>
      Promise.all(
        [alice, bob].map((userId) =>
          services.reserve.execute({
            eventId: event.data.id,
            userId,
            quantity: 1,
          }),
        ),
      ),
    )
    .then(async (results, { services, alice, bob }) => {
      expect(results.filter(Result.isSuccess)).toHaveLength(1)
      expect(results.filter(Result.isFailure)).toEqual([
        Result.fail(new Conflict('Not enough seats')),
      ])
      const stored = [
        ...(await services.read.reservationsFor.execute(alice)),
        ...(await services.read.reservationsFor.execute(bob)),
      ]
      expect(stored).toEqual(
        results.filter(Result.isSuccess).map((result) => result.value),
      )
    }))

test.each([0, -1, 1.5, 2147483648])(
  'invalid quantity %s leaves no booking or consumed seats',
  (quantity) =>
    given(anExistingEvent)
      .when(({ services, event, alice }) =>
        services.reserve.execute({
          eventId: event.data.id,
          userId: alice,
          quantity,
        }),
      )
      .then(async (result, { services, event, alice }) => {
        expect(result).toEqual(
          Result.fail(
            new InvalidInput('Quantity must be a positive 32-bit integer'),
          ),
        )
        const reservationsCandidate =
          await services.read.reservationsFor.execute(alice)
        expect(reservationsCandidate).toEqual([])
        const candidate = await services.reserve.execute({
          eventId: event.data.id,
          userId: alice,
          quantity: 1,
        })
        expect(Result.isSuccess(candidate)).toBe(true)
      }),
)

test('overbooking preserves existing reservations', () =>
  given(anEventWithReservation)
    .when(({ services, event, bob }) =>
      services.reserve.execute({
        eventId: event.data.id,
        userId: bob,
        quantity: 1,
      }),
    )
    .then(async (result, { services, reservation, alice, bob }) => {
      expect(result).toEqual(Result.fail(new Conflict('Not enough seats')))
      const aliceCandidate = await services.read.reservationsFor.execute(alice)
      expect(aliceCandidate).toEqual([reservation])
      const bobCandidate = await services.read.reservationsFor.execute(bob)
      expect(bobCandidate).toEqual([])
    }))

test('booking at the start uses the current clock and leaves no reservation', () =>
  given(async () => {
    const fixture = await anExistingEvent()
    fixture.advanceTo(fixture.event.data.startsAt)
    return fixture
  })
    .when(({ services, event, alice }) =>
      services.reserve.execute({
        eventId: event.data.id,
        userId: alice,
        quantity: 1,
      }),
    )
    .then(async (result, { services, alice }) => {
      expect(result).toEqual(
        Result.fail(new Conflict('Event has already started')),
      )
      const candidate = await services.read.reservationsFor.execute(alice)
      expect(candidate).toEqual([])
    }))

test('a missing event returns NotFound without a booking', () =>
  given(anApplication)
    .when(({ services, alice }) =>
      services.reserve.execute({
        eventId: EventId.make(),
        userId: alice,
        quantity: 1,
      }),
    )
    .then(async (result, { services, alice }) => {
      expect(result).toEqual(Result.fail(new NotFound('Event not found')))
      const candidate = await services.read.reservationsFor.execute(alice)
      expect(candidate).toEqual([])
    }))

test('an unknown user cannot book or consume capacity', () =>
  given(async () => ({
    ...(await anExistingEvent()),
    unknownUser: UserId.make(),
  }))
    .when(({ services, event, unknownUser }) =>
      services.reserve.execute({
        eventId: event.data.id,
        userId: unknownUser,
        quantity: 1,
      }),
    )
    .then(async (result, { services, event, alice, unknownUser }) => {
      expect(result).toEqual(
        Result.fail(
          new InvalidInput('Referenced venue or user does not exist'),
        ),
      )
      const reservationsCandidate =
        await services.read.reservationsFor.execute(unknownUser)
      expect(reservationsCandidate).toEqual([])
      const candidate = await services.reserve.execute({
        eventId: event.data.id,
        userId: alice,
        quantity: 1,
      })
      expect(Result.isSuccess(candidate)).toBe(true)
    }))
