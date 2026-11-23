import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MongoClient } from 'mongodb'
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers'
import { createContainer } from '#/composition-root.ts'
import type {
  EventCreated,
  EventUpdated,
} from '#/features/events/contracts/events.ts'
import {
  Event,
  type EventCreationData,
} from '#/features/events/domain/event.ts'
import { EventId, VenueId } from '#/features/events/domain/ids.ts'
import { InMemoryEventRepository } from '#/features/events/infrastructure/repository/in-memory-event-repository.ts'
import { MongoDBEventReadRepository } from '#/features/events/infrastructure/repository/mongodb-read-event-repository.ts'
import { TOKEN } from '#/platform/di/tokens.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

const venueId = VenueId.makeUnsafe('01900000-0000-7000-8000-000000000003')
const start = new Date('2030-01-02T18:00:00Z')
const later = new Date('2030-01-03T18:00:00Z')

function anEvent(overrides: Partial<EventCreationData> = {}) {
  return Result.getOrThrow(
    Event.create({
      id: EventId.make(),
      title: 'Game night',
      category: 'gaming',
      startsAt: start,
      capacity: 5,
      venueId,
      ...overrides,
    }),
  )
}

function eventMessage(
  _tag: 'EventCreated' | 'EventUpdated',
  event: Event,
): EventEnvelope<EventCreated | EventUpdated> {
  const { id, capacity, ...details } = event.data
  return {
    messageId: crypto.randomUUID(),
    occurredAt: new Date('2030-01-01T00:00:00Z'),
    version: 1,
    event: {
      _tag,
      content: { ...details, eventId: id, capacity: capacity.value },
    },
  }
}

describe('MongoDB event read model', () => {
  let mongo: StartedTestContainer
  let client: MongoClient

  beforeAll(async () => {
    mongo = await new GenericContainer('mongo:8.0')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start()
    client = new MongoClient(
      `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}`,
    )
  })

  afterAll(async () => {
    try {
      await client?.close()
    } finally {
      await mongo?.stop()
    }
  })

  const aProjection = () =>
    new MongoDBEventReadRepository(client.db(`events_${crypto.randomUUID()}`))

  describe('repository', () => {
    test('finds projected events by ID and leaves out events from the previous rebuild', async () => {
      const projection = aProjection()
      const original = anEvent()
      const replacement = anEvent({ title: 'Replacement' })
      await projection.replaceEvents([original])

      await projection.replaceEvents([replacement])

      expect(await projection.findEvent(replacement.data.id)).toEqual(
        Option.some(replacement),
      )
      expect(await projection.findEvent(original.data.id)).toEqual(
        Option.none(),
      )
    })

    test('lists by start time and ID and applies both filters', async () => {
      const projection = aProjection()
      const first = anEvent({
        id: EventId.makeUnsafe('01900000-0000-7000-8000-000000000001'),
      })
      const second = anEvent({
        id: EventId.makeUnsafe('01900000-0000-7000-8000-000000000002'),
      })
      const laterGame = anEvent({ startsAt: later })
      const laterConcert = anEvent({ category: 'music', startsAt: later })
      await projection.replaceEvents([laterGame, second, first, laterConcert])

      expect(await projection.listEvents({ category: 'gaming' })).toEqual([
        first,
        second,
        laterGame,
      ])
      expect(
        await projection.listEvents({ category: 'gaming', after: start }),
      ).toEqual([laterGame])
    })

    test('an empty rebuild clears the read model', async () => {
      const projection = aProjection()
      await projection.replaceEvents([anEvent()])

      await projection.replaceEvents([])

      expect(await projection.listEvents({})).toEqual([])
    })

    test('upserting an existing ID does not change other documents', async () => {
      const projection = aProjection()
      const original = anEvent()
      const other = anEvent({ startsAt: later })
      const updated = anEvent({ id: original.data.id, title: 'New title' })
      await projection.replaceEvents([original, other])

      await projection.upsertEvent(updated)

      expect(await projection.listEvents({})).toEqual([updated, other])
    })
  })

  describe('event bus subscriber', () => {
    function aSubscription() {
      const projection = aProjection()
      const repository = new InMemoryEventRepository({
        users: new Set(),
        venues: new Set([venueId]),
      })
      const container = createContainer({
        applicationSecretKey: 'test-application-secret-key-not-for-production',
        repository,
        readRepository: projection,
        notificationLogger: { log() {} },
      })
      return {
        projection,
        repository,
        bus: container.resolve(TOKEN.EventBus),
        list: container.resolve(TOKEN.ListEventsUseCase),
        get: container.resolve(TOKEN.GetEventUseCase),
      }
    }

    test('EventCreated projects only the event named in the message', async () => {
      const { repository, bus, list } = aSubscription()
      const event = anEvent()
      Result.getOrThrow(await repository.createEvent(event))
      Result.getOrThrow(await repository.createEvent(anEvent()))
      expect(await list.execute({})).toEqual([])

      await bus.publish(eventMessage('EventCreated', event))

      expect(await list.execute({})).toEqual([event])
    })

    test('replayed updates project the current committed event rather than the old payload', async () => {
      const { projection, repository, bus, get } = aSubscription()
      const original = anEvent()
      Result.getOrThrow(await repository.createEvent(original))
      await projection.replaceEvents([original])
      const updated = anEvent({
        id: original.data.id,
        title: 'Postponed',
        startsAt: later,
      })
      Result.getOrThrow(
        await repository.updateEvent(original.data.id, () =>
          Result.succeed(updated),
        ),
      )

      const staleMessage = eventMessage('EventUpdated', original)
      await bus.publish(staleMessage)
      await bus.publish(staleMessage)

      expect(await get.execute(original.data.id)).toEqual(
        Result.succeed(updated),
      )
    })
  })
})
