import { expect, test } from 'bun:test'
import { createApp } from '#/app.ts'
import { EventId, UserId, VenueId } from '#/domain/ids.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { Option } from '#/shared-kernel/option.ts'
import { given } from './support/given.ts'

function aBackend() {
  const alice = UserId.make()
  const bob = UserId.make()
  const venueId = VenueId.make()
  const repository = new InMemoryEventRepository({
    users: new Set([alice, bob]),
    venues: new Set([venueId]),
  })
  const app = createApp(repository, {
    now: () => new Date('2030-01-01T00:00:00Z'),
  })
  return { alice, bob, venueId, repository, app }
}
const eventInput = {
  title: 'Backend test',
  category: 'gaming',
  startsAt: '2099-01-01T18:00:00Z',
  capacity: 1,
}

async function createEvent(
  { app, venueId }: ReturnType<typeof aBackend>,
  patch = {},
) {
  return app.request('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...eventInput, venueId, ...patch }),
  })
}
async function aOneSeatEvent() {
  const backend = aBackend()
  const response = await createEvent(backend)
  expect(response.status).toBe(201)
  const event = await response.json()
  return { ...backend, event }
}
function reserve(
  app: ReturnType<typeof createApp>,
  eventId: string,
  userId: UserId,
) {
  return app.request(`/events/${eventId}/reservations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
    body: JSON.stringify({ quantity: 1 }),
  })
}
function cancel(
  app: ReturnType<typeof createApp>,
  reservationId: string,
  userId: UserId,
) {
  return app.request(`/reservations/${reservationId}/cancellation`, {
    method: 'POST',
    headers: { 'X-User-Id': userId },
  })
}

test('competing controller operations do not overbook the in-memory repository', () =>
  given(aOneSeatEvent)
    .when(({ app, event, alice, bob }) =>
      Promise.all([alice, bob].map((user) => reserve(app, event.id, user))),
    )
    .then((responses) => {
      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ])
    }))

test('missing records use Option and invalid references perform no writes', () =>
  given(aBackend)
    .when(async (backend) => ({
      found: await backend.repository.findEvent(EventId.make()),
      created: await createEvent(backend, { venueId: VenueId.make() }),
      missing: await backend.app.request(`/events/${EventId.make()}`),
    }))
    .then(async ({ found, created, missing }, { repository }) => {
      expect(found).toEqual(Option.none())
      expect(created.status).toBe(400)
      expect(missing.status).toBe(404)
      expect(await repository.listEvents({})).toEqual([])
    }))

test('controller cancellation enforces ownership and returns the seat', () =>
  given(async () => {
    const backend = await aOneSeatEvent()
    const response = await reserve(backend.app, backend.event.id, backend.alice)
    expect(response.status).toBe(201)
    return { ...backend, reservation: await response.json() }
  })
    .when(async ({ app, reservation, event, alice, bob }) => ({
      denied: await cancel(app, reservation.id, bob),
      cancelled: await cancel(app, reservation.id, alice),
      repeated: await cancel(app, reservation.id, alice),
      next: await reserve(app, event.id, bob),
    }))
    .then(
      async ({ denied, cancelled, repeated, next }, { repository, alice }) => {
        expect(denied.status).toBe(404)
        expect((await cancelled.json()).cancelledAt).toBe(
          '2030-01-01T00:00:00.000Z',
        )
        expect(repeated.status).toBe(409)
        expect(next.status).toBe(201)
        expect(
          (await repository.listReservations(alice))[0]!.data.cancelledAt,
        ).toEqual(Option.some(new Date('2030-01-01T00:00:00Z')))
      },
    ))

test('HTTP creation returns event data and Location and persists the event', () =>
  given(aBackend)
    .when(createEvent)
    .then(async (response, { repository }) => {
      expect(response.status).toBe(201)
      const event = await response.json()
      expect(response.headers.get('Location')).toBe(`/events/${event.id}`)
      expect(
        Option.isSome(await repository.findEvent(EventId.makeUnsafe(event.id))),
      ).toBe(true)
    }))

test('event filters use an exclusive date boundary and category', () =>
  given(async () => {
    const backend = await aOneSeatEvent()
    const response = await createEvent(backend, {
      title: 'Later',
      startsAt: '2099-01-02T18:00:00Z',
    })
    expect(response.status).toBe(201)
    return { ...backend, later: await response.json() }
  })
    .when(async ({ app, event }) => ({
      later: await (
        await app.request(
          `/events?category=gaming&after=${encodeURIComponent(event.startsAt)}`,
        )
      ).json(),
      unrelated: await (await app.request('/events?category=missing')).json(),
    }))
    .then(({ later, unrelated }, fixture) => {
      expect(later).toEqual([fixture.later])
      expect(unrelated).toEqual([])
    }))
