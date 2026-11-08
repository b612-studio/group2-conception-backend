import { RedisClient } from 'bun'
import { GenericContainer } from 'testcontainers'
import * as v from 'valibot'
import { anObservedApplication } from './telemetry-fixture.ts'
import {
  anOutboxApplication,
  startPostgresOutboxDatabase,
} from './postgres-outbox-fixture.ts'
import { inSpan } from '#/platform/observability/spans.ts'
import { ValkeyEventReadRepository } from '#/features/events/infrastructure/repository/valkey-event-read-repository.ts'
import { createEventsReadModelSubscriber } from '#/features/events/infrastructure/events-read-model-subscriber.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'

export async function startObservedPersistence() {
  const database = await startPostgresOutboxDatabase()
  try {
    const container = await new GenericContainer('valkey/valkey:8-alpine')
      .withExposedPorts(6379)
      .start()
    const redis = new RedisClient(
      `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    )
    return {
      database,
      redis,
      async reset() {
        await database.reset()
        await redis.send('FLUSHDB', [])
      },
      async close() {
        try {
          redis.close()
          await container.stop()
        } finally {
          await database.close()
        }
      },
    }
  } catch (cause) {
    await database.close()
    throw cause
  }
}

export function observedSpans(
  telemetry: ReturnType<typeof anObservedApplication>,
) {
  return {
    ...telemetry,
    span(name: string) {
      const span = telemetry
        .spans()
        .find((candidate) => candidate.name === name)
      if (!span) {
        throw new Error(`Expected a finished span named ${name}`)
      }
      return span
    },
    async measurement(name: string) {
      const measurement = (await telemetry.measurements()).find(
        (candidate) => candidate.descriptor.name === name,
      )
      if (!measurement) {
        throw new Error(`Expected an exported metric named ${name}`)
      }
      return measurement
    },
    exportedSpanData() {
      return JSON.stringify(
        telemetry.spans().map(({ name, attributes, events }) => ({
          name,
          attributes,
          events,
        })),
      )
    },
  }
}

export function anObservedOutbox(
  persistence: Awaited<ReturnType<typeof startObservedPersistence>>,
) {
  const telemetry = observedSpans(anObservedApplication())
  const app = anOutboxApplication(persistence.database)
  const event = app.event.data
  const message: EventEnvelope<DomainEvent> = {
    ...app.message,
    event: {
      _tag: 'EventCreated',
      content: {
        eventId: event.id,
        title: event.title,
        category: event.category,
        startsAt: event.startsAt,
        capacity: event.capacity.value,
        venueId: event.venueId,
      },
    },
  }
  const projection = new ValkeyEventReadRepository(persistence.redis)
  const subscriber = createEventsReadModelSubscriber(app.repository, projection)
  subscriber.subscribe(app.bus)
  return {
    ...app,
    ...telemetry,
    message,
    projection,
    redis: persistence.redis,
    commitEventAndMessage: () =>
      inSpan('request', () =>
        app.unitOfWork.run(async ({ events, outbox }) => {
          const result = await events.createEvent(app.event)
          await outbox.append(message)
          return result
        }),
      ),
    drain: () => inSpan('outbox.drain', () => app.dispatcher.drain()),
    async insertLegacyMessage() {
      await persistence.database
        .sql`INSERT INTO events.outbox (message_id, envelope) VALUES (${message.messageId}, ${message}::jsonb)`
    },
    async storedTraceContext() {
      const [row] = await app.storedMessages()
      return v.parse(
        v.object({
          envelope: v.object({
            traceContext: v.object({ traceparent: v.string() }),
          }),
        }),
        row,
      ).envelope.traceContext
    },
  }
}

export async function anOutboxWithObservedMessage(
  persistence: Awaited<ReturnType<typeof startObservedPersistence>>,
) {
  const fixture = anObservedOutbox(persistence)
  await fixture.commitEventAndMessage()
  return fixture
}

export async function anOutboxWithLegacyMessage(
  persistence: Awaited<ReturnType<typeof startObservedPersistence>>,
) {
  const fixture = anObservedOutbox(persistence)
  await fixture.insertLegacyMessage()
  return fixture
}
