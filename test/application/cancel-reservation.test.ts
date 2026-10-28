import { expect, test } from 'bun:test'
import { Conflict, NotFound } from '#/domain/errors.ts'
import { ReservationId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  anApplication,
  anEventWithReservation,
} from '../support/application-fixture.ts'
import { given } from '../support/given.ts'

test('the owner can cancel and the clock timestamp is persisted', () =>
  given(async () => {
    const fixture = await anEventWithReservation()
    const now = new Date('2030-01-01T12:00:00Z')
    fixture.advanceTo(now)
    return { ...fixture, now }
  })
    .when(({ services, reservation, alice }) =>
      services.cancel.execute(reservation.data.id, alice),
    )
    .then(async (result, { services, reservation, alice, now }) => {
      const cancelled = Result.getOrThrow(result)
      expect(cancelled.data).toEqual({
        ...reservation.data,
        cancelledAt: Option.some(now),
      })
      expect(await services.read.reservationsFor(alice)).toEqual([cancelled])
    }))

test('another user cannot cancel a booking or release its seats', () =>
  given(anEventWithReservation)
    .when(({ services, reservation, bob }) =>
      services.cancel.execute(reservation.data.id, bob),
    )
    .then(async (result, { services, event, reservation, alice, bob }) => {
      expect(result).toEqual(Result.fail(new NotFound('Reservation not found')))
      expect(await services.read.reservationsFor(alice)).toEqual([reservation])
      expect(
        await services.reserve.execute({
          eventId: event.data.id,
          userId: bob,
          quantity: 1,
        }),
      ).toEqual(Result.fail(new Conflict('Not enough seats')))
    }))

test('cancellation releases the full quantity for another user', () =>
  given(anEventWithReservation)
    .when(({ services, reservation, alice }) =>
      services.cancel.execute(reservation.data.id, alice),
    )
    .then(async (result, { services, event, bob }) => {
      Result.getOrThrow(result)
      const next = Result.getOrThrow(
        await services.reserve.execute({
          eventId: event.data.id,
          userId: bob,
          quantity: 2,
        }),
      )
      expect(next.data.quantity).toBe(2)
      expect(await services.read.reservationsFor(bob)).toEqual([next])
    }))

test('repeated cancellation preserves the original timestamp and cannot release seats twice', () =>
  given(async () => {
    const fixture = await anEventWithReservation()
    const { services, event, reservation, alice, bob } = fixture
    const cancelled = Result.getOrThrow(
      await services.cancel.execute(reservation.data.id, alice),
    )
    const replacement = Result.getOrThrow(
      await services.reserve.execute({
        eventId: event.data.id,
        userId: bob,
        quantity: 2,
      }),
    )
    fixture.advanceTo(new Date('2030-01-01T12:00:00Z'))
    return { ...fixture, cancelled, replacement }
  })
    .when(({ services, reservation, alice }) =>
      services.cancel.execute(reservation.data.id, alice),
    )
    .then(
      async (
        result,
        { services, event, alice, bob, cancelled, replacement },
      ) => {
        expect(result).toEqual(
          Result.fail(new Conflict('Reservation is already cancelled')),
        )
        expect(await services.read.reservationsFor(alice)).toEqual([cancelled])
        expect(await services.read.reservationsFor(bob)).toEqual([replacement])
        expect(
          await services.reserve.execute({
            eventId: event.data.id,
            userId: alice,
            quantity: 1,
          }),
        ).toEqual(Result.fail(new Conflict('Not enough seats')))
      },
    ))

test('cancelling a missing reservation returns NotFound', () =>
  given(anApplication)
    .when(({ services, alice }) =>
      services.cancel.execute(ReservationId.make(), alice),
    )
    .then((result) => {
      expect(result).toEqual(Result.fail(new NotFound('Reservation not found')))
    }))
