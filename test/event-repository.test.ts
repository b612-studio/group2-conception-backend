import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import type { EventRepository } from '#/application/ports.ts'
import { Event, type EventData } from '#/domain/event.ts'
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

function anEvent(overrides: Partial<EventData> = {}) {
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
    seats + quantity > event.data.capacity
      ? Result.fail(new Conflict('Not enough seats'))
      : Result.succeed(aReservation(eventId, { quantity })),
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
    }, 120_000)
    beforeEach(async () => {
      await fixture!.reset()
      repository = fixture!.repository
      peer = fixture!.peer
    })
    afterAll(async () => {
      await fixture?.close()
    }, 30_000)

    async function storeEvent(overrides: Partial<EventData> = {}) {
      const event = anEvent(overrides)
      expect(await repository.createEvent(event)).toEqual(Result.succeed(event))
      return event
    }

    test('empty storage returns None and empty lists; reference users are consistent', async () => {
      expect(await repository.findEvent(EventId.make())).toEqual(Option.none())
      expect(await repository.listEvents({})).toEqual([])
      expect(await repository.listReservations(alice)).toEqual([])
      expect(await repository.userExists(alice)).toBe(true)
      expect(await repository.userExists(bob)).toBe(true)
      expect(await repository.userExists(UserId.make())).toBe(false)
    })

    test('missing mutations return NotFound without invoking callbacks', async () => {
      const callback = () => {
        throw new Error('Callback must not run for a missing record')
      }
      expect(await repository.updateEvent(EventId.make(), callback)).toEqual(
        Result.fail(expect.any(NotFound)),
      )
      expect(await repository.reserve(EventId.make(), callback)).toEqual(
        Result.fail(expect.any(NotFound)),
      )
      expect(
        await repository.cancelReservation(
          ReservationId.make(),
          alice,
          callback,
        ),
      ).toEqual(Result.fail(expect.any(NotFound)))
    })

    test('createEvent returns the event and makes the complete domain value visible to another client', async () => {
      const event = await storeEvent()
      expect(await peer.findEvent(event.data.id)).toEqual(Option.some(event))
      expect(await peer.listEvents({})).toEqual([event])
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
      expect(await repository.listEvents({})).toEqual([early, low, high, other])
      expect(await repository.listEvents({ category: 'gaming' })).toEqual([
        early,
        low,
        high,
      ])
      expect(
        await repository.listEvents({ after: early.data.startsAt }),
      ).toEqual([low, high, other])
      expect(
        await repository.listEvents({
          category: 'gaming',
          after: early.data.startsAt,
        }),
      ).toEqual([low, high])
      expect(await repository.listEvents({ category: 'Gaming' })).toEqual([])
      expect(
        await repository.listEvents({ after: other.data.startsAt }),
      ).toEqual([])
    })

    test('createEvent rejects an unknown venue with InvalidInput and writes nothing', async () => {
      expect(
        await repository.createEvent(anEvent({ venueId: VenueId.make() })),
      ).toEqual(Result.fail(expect.any(InvalidInput)))
      expect(await peer.listEvents({})).toEqual([])
    })

    test('duplicate event IDs reject the promise without overwriting the original', async () => {
      const event = await storeEvent()
      expect(
        repository.createEvent(anEvent({ ...event.data, title: 'Duplicate' })),
      ).rejects.toThrow()
      expect(await peer.findEvent(event.data.id)).toEqual(Option.some(event))
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
      expect(
        await peer.updateEvent(event.data.id, (current, seats) => {
          expect(current).toEqual(event)
          expect(seats).toBe(3)
          return Result.succeed(updated)
        }),
      ).toEqual(Result.succeed(updated))
      expect(await repository.findEvent(event.data.id)).toEqual(
        Option.some(updated),
      )
    })

    test('updateEvent preserves storage on callback Failure or unknown venue', async () => {
      const event = await storeEvent()
      const failure = Result.fail(new Conflict('Rejected update'))
      expect(
        await repository.updateEvent(event.data.id, () => failure),
      ).toEqual(failure)
      expect(await peer.findEvent(event.data.id)).toEqual(Option.some(event))
      expect(
        await repository.updateEvent(event.data.id, () =>
          Result.succeed(anEvent({ ...event.data, venueId: VenueId.make() })),
        ),
      ).toEqual(Result.fail(expect.any(InvalidInput)))
      expect(await peer.findEvent(event.data.id)).toEqual(Option.some(event))
    })

    test('reserve passes the current event and accumulated seats, persisting the returned reservation', async () => {
      const event = await storeEvent()
      const first = Result.getOrThrow(
        await reserveSeats(repository, event.data.id, 2),
      )
      const second = aReservation(event.data.id, { userId: bob, quantity: 3 })
      expect(
        await peer.reserve(event.data.id, (current, seats) => {
          expect(current).toEqual(event)
          expect(seats).toBe(2)
          return Result.succeed(second)
        }),
      ).toEqual(Result.succeed(second))
      expect(await repository.listReservations(alice)).toEqual([first])
      expect(await repository.listReservations(bob)).toEqual([second])
    })

    test('reserve preserves storage on callback Failure or unknown user', async () => {
      const event = await storeEvent()
      const failure = Result.fail(new Conflict('Rejected reservation'))
      expect(await repository.reserve(event.data.id, () => failure)).toEqual(
        failure,
      )
      expect(
        await repository.reserve(event.data.id, () =>
          Result.succeed(
            aReservation(event.data.id, { userId: UserId.make() }),
          ),
        ),
      ).toEqual(Result.fail(expect.any(InvalidInput)))
      expect(await peer.listReservations(alice)).toEqual([])
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
        expect(
          await repository.reserve(event.data.id, () =>
            Result.succeed(reservation),
          ),
        ).toEqual(Result.succeed(reservation))
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
      expect(await repository.listReservations(alice)).toEqual([
        cancelled,
        high,
        later,
      ])
      expect(await repository.listReservations(bob)).toEqual([bobs])
    })

    test('cancelReservation hides other users records without invoking the callback', async () => {
      const event = await storeEvent()
      const reservation = Result.getOrThrow(
        await reserveSeats(repository, event.data.id),
      )
      expect(
        await peer.cancelReservation(reservation.data.id, bob, () => {
          throw new Error('Callback must not run for another user')
        }),
      ).toEqual(Result.fail(expect.any(NotFound)))
      expect(await repository.listReservations(alice)).toEqual([reservation])
    })

    test('cancelReservation passes the stored value, preserves callback Failure and persists Success', async () => {
      const event = await storeEvent()
      const reservation = Result.getOrThrow(
        await reserveSeats(repository, event.data.id),
      )
      const failure = Result.fail(new Conflict('Rejected cancellation'))
      expect(
        await peer.cancelReservation(reservation.data.id, alice, (current) => {
          expect(current).toEqual(reservation)
          return failure
        }),
      ).toEqual(failure)
      expect(await repository.listReservations(alice)).toEqual([reservation])
      const cancelled = new Reservation({
        ...reservation.data,
        cancelledAt: Option.some(cancelledAt),
      })
      expect(
        await peer.cancelReservation(reservation.data.id, alice, () =>
          Result.succeed(cancelled),
        ),
      ).toEqual(Result.succeed(cancelled))
      expect(await repository.listReservations(alice)).toEqual([cancelled])
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
      expect(
        await peer.reserve(event.data.id, (_, seats) => {
          expect(seats).toBe(3)
          return failure
        }),
      ).toEqual(failure)
    })

    test('concurrent reserve callbacks serialize capacity checks and writes across clients', async () => {
      const event = await storeEvent({ capacity: 1 })
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          reserveSeats(index % 2 ? repository : peer, event.data.id),
        ),
      )
      expect(
        results.filter((result) => result._tag === 'Success'),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result._tag === 'Failure'),
      ).toHaveLength(11)
      expect(await repository.listReservations(alice)).toHaveLength(1)
    })

    test('concurrent updateEvent and reserve callbacks share the same serialization boundary', async () => {
      const event = await storeEvent({ capacity: 2 })
      const smaller = anEvent({ ...event.data, capacity: 1 })
      const results = await Promise.all([
        repository.updateEvent(event.data.id, (_, seats) =>
          seats > smaller.data.capacity
            ? Result.fail(new Conflict('Capacity below reserved seats'))
            : Result.succeed(smaller),
        ),
        reserveSeats(peer, event.data.id, 2),
      ])
      expect(
        results.filter((result) => result._tag === 'Success'),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result._tag === 'Failure'),
      ).toHaveLength(1)
      expect(await repository.findEvent(event.data.id)).toEqual(
        Option.some(results[0]!._tag === 'Success' ? smaller : event),
      )
      expect(await repository.listReservations(alice)).toHaveLength(
        results[1]!._tag === 'Success' ? 1 : 0,
      )
    })
  },
)
