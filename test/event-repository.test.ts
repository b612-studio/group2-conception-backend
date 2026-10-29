import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { EventRepository } from '#/application/ports.ts'
import { Event, type EventCreationData } from '#/domain/event.ts'
import { Reservation, type ReservationData } from '#/domain/reservation.ts'
import { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'
import { Conflict, InvalidInput, NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  alice,
  bob,
  venueId,
  repositoryFactories,
  type RepositoryFixture,
} from './support/event-repository-fixtures.ts'

const createdAt = new Date('2030-01-01T00:00:00Z')
const cancelledAt = new Date('2030-01-02T00:00:00Z')

function anEvent(overrides: Partial<EventCreationData> = {}) {
  return Result.getOrThrow(
    Event.create({
      id: EventId.make(),
      title: 'Contract event',
      category: 'gaming',
      startsAt: new Date('2099-01-01T18:00:00Z'),
      capacity: 10,
      venueId,
      ...overrides,
    }),
  )
}

function aReservation(
  eventId: EventId,
  overrides: Partial<ReservationData> = {},
) {
  return new Reservation({
    id: ReservationId.make(),
    eventId,
    userId: alice,
    quantity: 1,
    createdAt,
    cancelledAt: Option.none(),
    ...overrides,
  })
}

// A callback supplied by a consumer of the port. The repository must serialize
// its capacity read and write; this suite does not go through application handlers.
function reserveSeats(
  repository: EventRepository,
  eventId: EventId,
  quantity = 1,
) {
  return repository.reserve(eventId, (event, seats) =>
    Result.map(event.checkReservation(quantity, seats, createdAt), () =>
      aReservation(eventId, { quantity }),
    ),
  )
}

describe.each(repositoryFactories)(
  'EventRepository contract: $name',
  ({ create }) => {
    let fixture: RepositoryFixture | undefined
    let repository: EventRepository
    let peer: EventRepository

    beforeAll(async () => {
      fixture = await create()
    })
    beforeEach(async () => {
      await fixture!.reset()
      repository = fixture!.repository
      peer = fixture!.peer
    })
    afterAll(async () => {
      await fixture?.close()
    })

    async function storeEvent(overrides: Partial<EventCreationData> = {}) {
      const event = anEvent(overrides)
      const candidate = await repository.createEvent(event)
      expect(candidate).toEqual(Result.succeed(event))
      return event
    }

    test('empty storage returns None and empty lists; reference users are consistent', async () => {
      const eventCandidate = await repository.findEvent(EventId.make())
      expect(eventCandidate).toEqual(Option.none())
      const eventsCandidate = await repository.listEvents({})
      expect(eventsCandidate).toEqual([])
      const reservationsCandidate = await repository.listReservations(alice)
      expect(reservationsCandidate).toEqual([])
      const aliceCandidate = await repository.userExists(alice)
      expect(aliceCandidate).toBe(true)
      const bobCandidate = await repository.userExists(bob)
      expect(bobCandidate).toBe(true)
      const unknownUserCandidate = await repository.userExists(UserId.make())
      expect(unknownUserCandidate).toBe(false)
    })

    test('missing mutations return NotFound without invoking callbacks', async () => {
      const callback = () => {
        throw new Error('Callback must not run for a missing record')
      }
      const updateCandidate = await repository.updateEvent(
        EventId.make(),
        callback,
      )
      expect(updateCandidate).toEqual(Result.fail(expect.any(NotFound)))
      const reserveCandidate = await repository.reserve(
        EventId.make(),
        callback,
      )
      expect(reserveCandidate).toEqual(Result.fail(expect.any(NotFound)))
      const cancelCandidate = await repository.cancelReservation(
        ReservationId.make(),
        alice,
        callback,
      )
      expect(cancelCandidate).toEqual(Result.fail(expect.any(NotFound)))
    })

    test('createEvent returns the event and makes the complete domain value visible to another client', async () => {
      const event = await storeEvent()
      const eventCandidate = await peer.findEvent(event.data.id)
      expect(eventCandidate).toEqual(Option.some(event))
      const eventsCandidate = await peer.listEvents({})
      expect(eventsCandidate).toEqual([event])
    })

    test('listEvents filters by exact category and exclusive date, sorting by date then ID', async () => {
      const early = await storeEvent()
      const startsAt = new Date('2099-01-02T18:00:00Z')
      const high = await storeEvent({
        startsAt,
        id: EventId.makeUnsafe('01900000-0000-7000-8000-000000000020'),
      })
      const low = await storeEvent({
        startsAt,
        id: EventId.makeUnsafe('01900000-0000-7000-8000-000000000010'),
      })
      const other = await storeEvent({
        category: 'music',
        startsAt: new Date('2099-01-03T18:00:00Z'),
      })
      const allCandidate = await repository.listEvents({})
      expect(allCandidate).toEqual([early, low, high, other])
      const categoryCandidate = await repository.listEvents({
        category: 'gaming',
      })
      expect(categoryCandidate).toEqual([early, low, high])
      const afterCandidate = await repository.listEvents({
        after: early.data.startsAt,
      })
      expect(afterCandidate).toEqual([low, high, other])
      const combinedCandidate = await repository.listEvents({
        category: 'gaming',
        after: early.data.startsAt,
      })
      expect(combinedCandidate).toEqual([low, high])
      const caseSensitiveCandidate = await repository.listEvents({
        category: 'Gaming',
      })
      expect(caseSensitiveCandidate).toEqual([])
      const lastDateCandidate = await repository.listEvents({
        after: other.data.startsAt,
      })
      expect(lastDateCandidate).toEqual([])
    })

    test('createEvent rejects an unknown venue with InvalidInput and writes nothing', async () => {
      const candidate = await repository.createEvent(
        anEvent({ venueId: VenueId.make() }),
      )
      expect(candidate).toEqual(Result.fail(expect.any(InvalidInput)))
      const eventsCandidate = await peer.listEvents({})
      expect(eventsCandidate).toEqual([])
    })

    test('duplicate event IDs reject the promise without overwriting the original', async () => {
      const event = await storeEvent()
      const candidate = repository.createEvent(
        anEvent({
          ...event.data,
          capacity: event.data.capacity.value,
          title: 'Duplicate',
        }),
      )
      expect(candidate).rejects.toThrow()
      const storedCandidate = await peer.findEvent(event.data.id)
      expect(storedCandidate).toEqual(Option.some(event))
    })

    test('updateEvent passes the current event and reserved seats to the callback, then persists its result', async () => {
      const event = await storeEvent()
      Result.getOrThrow(await reserveSeats(repository, event.data.id, 3))
      const updated = anEvent({
        ...event.data,
        title: 'Updated',
        category: 'music',
        capacity: 5,
        startsAt: new Date('2099-02-01T18:00:00Z'),
      })
      const candidate = await peer.updateEvent(
        event.data.id,
        (current, seats) => {
          expect(current).toEqual(event)
          expect(seats).toBe(3)
          return Result.succeed(updated)
        },
      )
      expect(candidate).toEqual(Result.succeed(updated))
      const storedCandidate = await repository.findEvent(event.data.id)
      expect(storedCandidate).toEqual(Option.some(updated))
    })

    test('updateEvent preserves storage on callback Failure or unknown venue', async () => {
      const event = await storeEvent()
      const failure = Result.fail(new Conflict('Rejected update'))
      const failureCandidate = await repository.updateEvent(
        event.data.id,
        () => failure,
      )
      expect(failureCandidate).toEqual(failure)
      const afterFailureCandidate = await peer.findEvent(event.data.id)
      expect(afterFailureCandidate).toEqual(Option.some(event))
      const venueCandidate = await repository.updateEvent(event.data.id, () =>
        Result.succeed(
          anEvent({
            ...event.data,
            capacity: event.data.capacity.value,
            venueId: VenueId.make(),
          }),
        ),
      )
      expect(venueCandidate).toEqual(Result.fail(expect.any(InvalidInput)))
      const afterVenueCandidate = await peer.findEvent(event.data.id)
      expect(afterVenueCandidate).toEqual(Option.some(event))
    })

    test('reserve passes the current event and accumulated seats, persisting the returned reservation', async () => {
      const event = await storeEvent()
      const first = Result.getOrThrow(
        await reserveSeats(repository, event.data.id, 2),
      )
      const second = aReservation(event.data.id, { userId: bob, quantity: 3 })
      const candidate = await peer.reserve(event.data.id, (current, seats) => {
        expect(current).toEqual(event)
        expect(seats).toBe(2)
        return Result.succeed(second)
      })
      expect(candidate).toEqual(Result.succeed(second))
      const aliceCandidate = await repository.listReservations(alice)
      expect(aliceCandidate).toEqual([first])
      const bobCandidate = await repository.listReservations(bob)
      expect(bobCandidate).toEqual([second])
    })

    test('reserve preserves storage on callback Failure or unknown user', async () => {
      const event = await storeEvent()
      const failure = Result.fail(new Conflict('Rejected reservation'))
      const failureCandidate = await repository.reserve(
        event.data.id,
        () => failure,
      )
      expect(failureCandidate).toEqual(failure)
      const userCandidate = await repository.reserve(event.data.id, () =>
        Result.succeed(aReservation(event.data.id, { userId: UserId.make() })),
      )
      expect(userCandidate).toEqual(Result.fail(expect.any(InvalidInput)))
      const reservationsCandidate = await peer.listReservations(alice)
      expect(reservationsCandidate).toEqual([])
      await peer.updateEvent(event.data.id, (current, seats) => {
        expect(seats).toBe(0)
        return Result.succeed(current)
      })
    })

    test('listReservations isolates users, includes cancelled records and sorts by creation date then ID', async () => {
      const event = await storeEvent()
      const later = aReservation(event.data.id, {
        createdAt: new Date('2030-01-03T00:00:00Z'),
      })
      const high = aReservation(event.data.id, {
        id: ReservationId.makeUnsafe('01900000-0000-7000-8000-000000000020'),
      })
      const low = aReservation(event.data.id, {
        id: ReservationId.makeUnsafe('01900000-0000-7000-8000-000000000010'),
      })
      const bobs = aReservation(event.data.id, { userId: bob })
      for (const reservation of [later, high, low, bobs]) {
        const candidate = await repository.reserve(event.data.id, () =>
          Result.succeed(reservation),
        )
        expect(candidate).toEqual(Result.succeed(reservation))
      }
      const cancelled = new Reservation({
        ...low.data,
        cancelledAt: Option.some(cancelledAt),
      })
      Result.getOrThrow(
        await peer.cancelReservation(low.data.id, alice, () =>
          Result.succeed(cancelled),
        ),
      )
      const aliceCandidate = await repository.listReservations(alice)
      expect(aliceCandidate).toEqual([cancelled, high, later])
      const bobCandidate = await repository.listReservations(bob)
      expect(bobCandidate).toEqual([bobs])
    })

    test('cancelReservation hides other users records without invoking the callback', async () => {
      const event = await storeEvent()
      const reservation = Result.getOrThrow(
        await reserveSeats(repository, event.data.id),
      )
      const candidate = await peer.cancelReservation(
        reservation.data.id,
        bob,
        () => {
          throw new Error('Callback must not run for another user')
        },
      )
      expect(candidate).toEqual(Result.fail(expect.any(NotFound)))
      const reservationsCandidate = await repository.listReservations(alice)
      expect(reservationsCandidate).toEqual([reservation])
    })

    test('cancelReservation passes the stored value, preserves callback Failure and persists Success', async () => {
      const event = await storeEvent()
      const reservation = Result.getOrThrow(
        await reserveSeats(repository, event.data.id),
      )
      const failure = Result.fail(new Conflict('Rejected cancellation'))
      const failureCandidate = await peer.cancelReservation(
        reservation.data.id,
        alice,
        (current) => {
          expect(current).toEqual(reservation)
          return failure
        },
      )
      expect(failureCandidate).toEqual(failure)
      const afterFailureCandidate = await repository.listReservations(alice)
      expect(afterFailureCandidate).toEqual([reservation])
      const cancelled = new Reservation({
        ...reservation.data,
        cancelledAt: Option.some(cancelledAt),
      })
      const candidate = await peer.cancelReservation(
        reservation.data.id,
        alice,
        () => Result.succeed(cancelled),
      )
      expect(candidate).toEqual(Result.succeed(cancelled))
      const storedCandidate = await repository.listReservations(alice)
      expect(storedCandidate).toEqual([cancelled])
    })

    test('reservedSeats counts quantities only for active reservations on the requested event', async () => {
      const event = await storeEvent()
      const other = await storeEvent()
      const cancelled = Result.getOrThrow(
        await reserveSeats(repository, event.data.id, 2),
      )
      Result.getOrThrow(await reserveSeats(repository, event.data.id, 3))
      Result.getOrThrow(await reserveSeats(repository, other.data.id, 7))
      Result.getOrThrow(
        await peer.cancelReservation(cancelled.data.id, alice, (current) =>
          Result.succeed(
            new Reservation({
              ...current.data,
              cancelledAt: Option.some(cancelledAt),
            }),
          ),
        ),
      )
      await repository.updateEvent(event.data.id, (current, seats) => {
        expect(seats).toBe(3)
        return Result.succeed(current)
      })
      const failure = Result.fail(new Conflict('Observe without writing'))
      const candidate = await peer.reserve(event.data.id, (_, seats) => {
        expect(seats).toBe(3)
        return failure
      })
      expect(candidate).toEqual(failure)
    })

    test('concurrent reserve callbacks serialize capacity checks and writes across clients', async () => {
      const event = await storeEvent({ capacity: 1 })
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          reserveSeats(index % 2 ? repository : peer, event.data.id),
        ),
      )
      expect(results.filter(Result.isSuccess)).toHaveLength(1)
      expect(results.filter(Result.isFailure)).toHaveLength(11)
      const candidate = await repository.listReservations(alice)
      expect(candidate).toHaveLength(1)
    })

    test('concurrent updateEvent and reserve callbacks share the same serialization boundary', async () => {
      const event = await storeEvent({ capacity: 2 })
      const smaller = anEvent({ ...event.data, capacity: 1 })
      const results = await Promise.all([
        repository.updateEvent(event.data.id, (_, seats) => {
          if (!smaller.data.capacity.accommodates(seats)) {
            return Result.fail(new Conflict('Capacity below reserved seats'))
          }
          return Result.succeed(smaller)
        }),
        reserveSeats(peer, event.data.id, 2),
      ])
      expect(results.filter(Result.isSuccess)).toHaveLength(1)
      expect(results.filter(Result.isFailure)).toHaveLength(1)
      const eventCandidate = await repository.findEvent(event.data.id)
      expect(eventCandidate).toEqual(
        Option.some(Result.isSuccess(results[0]!) ? smaller : event),
      )
      const reservationsCandidate = await repository.listReservations(alice)
      expect(reservationsCandidate).toHaveLength(
        Result.isSuccess(results[1]!) ? 1 : 0,
      )
    })
  },
)
