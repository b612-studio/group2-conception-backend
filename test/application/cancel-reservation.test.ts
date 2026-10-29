import { expect, test } from 'bun:test'
import { Conflict, NotFound } from '#/features/events/domain/errors.ts'
import { ReservationId } from '#/features/events/domain/ids.ts'
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
      services.cancel.execute({ id: reservation.data.id, userId: alice }),
    )
    .then(async (result, { services, reservation, alice, now }) => {
      const cancelled = Result.getOrThrow(result)
      expect(cancelled.data).toEqual({
        ...reservation.data,
        cancelledAt: Option.some(now),
      })
      const candidate = await services.read.reservationsFor.execute(alice)
      expect(candidate).toEqual([cancelled])
    }))

test('another user cannot cancel a booking or release its seats', () =>
  given(anEventWithReservation)
    .when(({ services, reservation, bob }) =>
      services.cancel.execute({ id: reservation.data.id, userId: bob }),
    )
    .then(async (result, { services, event, reservation, alice, bob }) => {
      expect(result).toEqual(Result.fail(new NotFound('Reservation not found')))
      const reservationsCandidate =
        await services.read.reservationsFor.execute(alice)
      expect(reservationsCandidate).toEqual([reservation])
      const candidate = await services.reserve.execute({
        eventId: event.data.id,
        userId: bob,
        quantity: 1,
      })
      expect(candidate).toEqual(Result.fail(new Conflict('Not enough seats')))
    }))

test('cancellation releases the full quantity for another user', () =>
  given(anEventWithReservation)
    .when(({ services, reservation, alice }) =>
      services.cancel.execute({ id: reservation.data.id, userId: alice }),
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
      const candidate = await services.read.reservationsFor.execute(bob)
      expect(candidate).toEqual([next])
    }))

test('repeated cancellation preserves the original timestamp and cannot release seats twice', () =>
  given(async () => {
    const fixture = await anEventWithReservation()
    const { services, event, reservation, alice, bob } = fixture
    const cancelled = Result.getOrThrow(
      await services.cancel.execute({ id: reservation.data.id, userId: alice }),
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
      services.cancel.execute({ id: reservation.data.id, userId: alice }),
    )
    .then(
      async (
        result,
        { services, event, alice, bob, cancelled, replacement },
      ) => {
        expect(result).toEqual(
          Result.fail(new Conflict('Reservation is already cancelled')),
        )
        const aliceCandidate =
          await services.read.reservationsFor.execute(alice)
        expect(aliceCandidate).toEqual([cancelled])
        const bobCandidate = await services.read.reservationsFor.execute(bob)
        expect(bobCandidate).toEqual([replacement])
        const candidate = await services.reserve.execute({
          eventId: event.data.id,
          userId: alice,
          quantity: 1,
        })
        expect(candidate).toEqual(Result.fail(new Conflict('Not enough seats')))
      },
    ))

test('cancelling a missing reservation returns NotFound', () =>
  given(anApplication)
    .when(({ services, alice }) =>
      services.cancel.execute({ id: ReservationId.make(), userId: alice }),
    )
    .then((result) => {
      expect(result).toEqual(Result.fail(new NotFound('Reservation not found')))
    }))
