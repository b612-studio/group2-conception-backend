import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'bun:test'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { given } from '../support/given.ts'
import { stopTelemetry } from '../support/telemetry-fixture.ts'
import {
  anObservedOutbox,
  anOutboxWithLegacyMessage,
  anOutboxWithObservedMessage,
  startObservedPersistence,
} from '../support/persistence-observability-fixture.ts'
import { inSpan, postgresQuery } from '#/platform/observability/spans.ts'
import { loggedSql } from '#/platform/observability/logged-sql.ts'
import { ValkeyEventRepository } from '#/features/events/infrastructure/repository/valkey-event-repository.ts'
import { FunctionalValkeyEventRepository } from '#/features/events/infrastructure/repository/valkey-event-repository-functional.ts'
import { Result } from '#/shared-kernel/result.ts'
import { InvalidInput } from '#/features/events/domain/errors.ts'

let persistence: Awaited<ReturnType<typeof startObservedPersistence>>
beforeAll(async () => {
  persistence = await startObservedPersistence()
})
beforeEach(async () => {
  await persistence.reset()
})
afterEach(stopTelemetry)
afterAll(async () => {
  await persistence?.close()
})

const anApplication = () => anObservedOutbox(persistence)
const aPendingMessage = () => anOutboxWithObservedMessage(persistence)
const aLegacyMessage = () => anOutboxWithLegacyMessage(persistence)
const aFailingDelivery = async () => {
  const app = await aLegacyMessage()
  const stopFailing = app.bus.subscribe('EventCreated', () => {
    throw new Error('private-payload-and-password')
  })
  return { ...app, stopFailing }
}

test('native SQL spans separate repository work from query time inside a transaction', () =>
  given(anApplication)
    .when(({ commitEventAndMessage }) => commitEventAndMessage())
    .then((_result, { span }) => {
      expect(span('events.transaction').parentSpanContext?.spanId).toBe(
        span('request').spanContext().spanId,
      )
      expect(
        span('EventRepository.createEvent').parentSpanContext?.spanId,
      ).toBe(span('events.transaction').spanContext().spanId)
      expect(span('INSERT events.events').parentSpanContext?.spanId).toBe(
        span('EventRepository.createEvent').spanContext().spanId,
      )
      expect(span('INSERT events.events')).toMatchObject({
        kind: SpanKind.CLIENT,
        attributes: {
          'db.system.name': 'postgresql',
          'db.operation.name': 'INSERT',
          'db.collection.name': 'events.events',
        },
      })
    }))

test('an outbox row persists the active producer context', () =>
  given(anApplication)
    .when(({ commitEventAndMessage }) => commitEventAndMessage())
    .then(async (_result, { span, storedTraceContext }) => {
      const producer = span('outbox.append').spanContext()
      expect(await storedTraceContext()).toEqual({
        traceparent: `00-${producer.traceId}-${producer.spanId}-01`,
      })
    }))

test('outbox processing links back to the producer without reparenting the drain', () =>
  given(aPendingMessage)
    .when(({ drain }) => drain())
    .then((delivered, { span }) => {
      expect(delivered).toBe(1)
      const process = span('outbox.process')
      expect(process.kind).toBe(SpanKind.CONSUMER)
      expect(process.links.map(({ context }) => context.spanId)).toEqual([
        span('outbox.append').spanContext().spanId,
      ])
      expect(process.spanContext().traceId).toBe(
        span('outbox.drain').spanContext().traceId,
      )
      expect(process.spanContext().traceId).not.toBe(
        span('outbox.append').spanContext().traceId,
      )
    }))

test('delivery traces the projection refresh and strips transport metadata before notifying listeners', () =>
  given(aPendingMessage)
    .when(({ drain }) => drain())
    .then(
      async (
        _delivered,
        { span, spans, message, messages, projection, event, pendingMessages },
      ) => {
        const refreshParent = span('events.readModel.refresh').parentSpanContext
          ?.spanId
        expect(
          spans().find(
            (candidate) => candidate.spanContext().spanId === refreshParent,
          )?.name,
        ).toBe('event.listener')
        expect(span('SET').parentSpanContext?.spanId).toBe(
          span('EventProjectionRepository.replaceEvents').spanContext().spanId,
        )
        expect(span('UPDATE events.outbox').kind).toBe(SpanKind.CLIENT)
        expect(messages).toEqual([message])
        expect(await projection.listEvents({})).toEqual([event])
        expect(await pendingMessages()).toEqual([])
      },
    ))

test('outbox rows written before tracing was added still deliver without a producer link', () =>
  given(aLegacyMessage)
    .when(({ drain }) => drain())
    .then((delivered, { span }) => {
      expect(delivered).toBe(1)
      expect(span('outbox.process').links).toEqual([])
    }))

test('a listener failure marks delivery failed and leaves the message pending', () =>
  given(aFailingDelivery)
    .when(({ drain }) => Result.tryPromise(drain, (cause) => cause))
    .then(
      async (result, { span, spans, pendingMessages, exportedSpanData }) => {
        expect(Result.isFailure(result)).toBe(true)
        expect(span('outbox.process').status.code).toBe(SpanStatusCode.ERROR)
        expect(
          spans()
            .filter((candidate) => candidate.name === 'event.listener')
            .map(({ status }) => status.code),
        ).toContain(SpanStatusCode.ERROR)
        expect(await pendingMessages()).toHaveLength(1)
        expect(exportedSpanData()).not.toContain('private-payload-and-password')
      },
    ))

test('a failed delivery can be retried after the listener recovers', () =>
  given(async () => {
    const app = await aFailingDelivery()
    await Result.tryPromise(app.drain, (cause) => cause)
    app.stopFailing()
    return app
  })
    .when(({ drain }) => drain())
    .then(async (delivered, { pendingMessages, measurement }) => {
      expect(delivered).toBe(1)
      expect(await pendingMessages()).toEqual([])
      expect(
        (await measurement('events.outbox.delivery.attempts')).dataPoints,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            value: 1,
            attributes: { outcome: 'failed' },
          }),
          expect.objectContaining({
            value: 1,
            attributes: { outcome: 'delivered' },
          }),
          expect.objectContaining({
            value: 1,
            attributes: { outcome: 'empty' },
          }),
        ]),
      )
    }))

test('a business rejection rolls back writes without marking the transaction as an infrastructure failure', () =>
  given(() => ({
    ...anApplication(),
    rejection: Result.fail(new InvalidInput('business rejection')),
  }))
    .when(({ unitOfWork, event, rejection }) =>
      unitOfWork.run(async ({ events }) => {
        await events.createEvent(event)
        return rejection
      }),
    )
    .then(async (result, { rejection, span, storedEvents }) => {
      expect(result).toBe(rejection)
      expect(await storedEvents()).toEqual([])
      expect(span('events.transaction')).toMatchObject({
        status: { code: SpanStatusCode.UNSET },
        attributes: { 'transaction.outcome': 'rolled_back' },
      })
    }))

test.each([
  { name: 'iterative', Repository: ValkeyEventRepository },
  { name: 'functional', Repository: FunctionalValkeyEventRepository },
])(
  'the $name Valkey adapter exposes each command beneath its repository operation',
  ({ Repository }) =>
    given(() => {
      const app = anApplication()
      const repository = new Repository(app.redis, {
        users: new Set([app.alice]),
        venues: new Set([app.event.data.venueId]),
      })
      return { ...app, repository }
    })
      .when(({ repository, event }) => repository.createEvent(event))
      .then((result, { span, spans }) => {
        expect(Result.isSuccess(result)).toBe(true)
        const operation = span('EventRepository.createEvent')
        expect(
          spans()
            .filter(
              (candidate) =>
                candidate.parentSpanContext?.spanId ===
                operation.spanContext().spanId,
            )
            .map(({ name }) => name),
        ).toEqual(['GET', 'EVAL'])
        expect(span('EVAL')).toMatchObject({
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system.name': 'redis',
            'db.operation.name': 'EVAL',
          },
        })
      }),
)

test('concurrent projection reads retain their own trace context', () =>
  given(anApplication)
    .when(({ projection }) =>
      Promise.all(
        ['read-a', 'read-b'].map((name) =>
          inSpan(name, () => projection.listEvents({})),
        ),
      ),
    )
    .then((_results, { span, spans }) => {
      for (const name of ['read-a', 'read-b']) {
        const root = span(name)
        const operations = spans().filter(
          (candidate) =>
            candidate.parentSpanContext?.spanId === root.spanContext().spanId,
        )
        expect(operations.map(({ name }) => name)).toEqual([
          'EventProjectionRepository.listEvents',
        ])
        expect(
          spans().filter(
            (candidate) =>
              candidate.name === 'GET' &&
              candidate.spanContext().traceId === root.spanContext().traceId,
          ),
        ).toHaveLength(1)
      }
    }))

test('database metrics count individual commands separately from repository operations', () =>
  given(anApplication)
    .when(({ projection }) => projection.listEvents({}))
    .then(async (_events, { measurement }) => {
      expect(await measurement('db.client.operation.duration')).toMatchObject({
        descriptor: { unit: 's' },
        dataPoints: [
          {
            attributes: {
              'db.system.name': 'redis',
              'db.operation.name': 'GET',
              outcome: 'completed',
            },
            value: { count: 1, sum: expect.any(Number) },
          },
        ],
      })
      expect(
        await measurement('events.repository.operation.duration'),
      ).toMatchObject({
        descriptor: { unit: 's' },
        dataPoints: [
          {
            attributes: {
              'operation.name': 'EventProjectionRepository.listEvents',
              outcome: 'completed',
            },
            value: { count: 1 },
          },
        ],
      })
    }))

test('a delivered message records its age and the work performed by each listener', () =>
  given(aPendingMessage)
    .when(({ drain }) => drain())
    .then(async (_delivered, { measurement }) => {
      expect(await measurement('events.outbox.message.age')).toMatchObject({
        descriptor: { unit: 's' },
        dataPoints: [
          { attributes: {}, value: { count: 1, sum: expect.any(Number) } },
        ],
      })
      expect(
        await measurement('events.messaging.listener.duration'),
      ).toMatchObject({
        descriptor: { unit: 's' },
        dataPoints: [
          {
            attributes: { 'event.type': 'EventCreated', outcome: 'completed' },
            value: { count: 2 },
          },
        ],
      })
    }))

test('SQL templates are logged with placeholders and the query span context', () =>
  given(anApplication)
    .when(({ commitEventAndMessage }) => commitEventAndMessage())
    .then((_result, { logs, span, event, message }) => {
      const records = logs().filter(
        (record) => record.body === 'Executing SQL query',
      )
      expect(records).toHaveLength(2)
      const query = span('INSERT events.events')
      expect(records[0]?.attributes['db.query.text']).toContain(
        'VALUES ($1, $2, $3, $4, $5, $6)',
      )
      expect(records[0]?.spanContext).toEqual(query.spanContext())
      expect(records[0]?.attributes['db.query.text']).toBe(
        query.attributes['db.query.text'],
      )
      const serialized = JSON.stringify(
        records.map((record) => record.attributes),
      )
      expect(serialized).not.toContain(event.data.title)
      expect(serialized).not.toContain(event.data.id)
      expect(serialized).not.toContain(message.messageId)
    }))

test('parameterized unsafe queries log SQL without bound values', () =>
  given(anApplication)
    .when(({ repository, event }) => repository.findEvent(event.data.id))
    .then((_result, { logs, event, span }) => {
      expect(logs()).toHaveLength(1)
      expect(logs()[0]?.attributes['db.query.text']).toContain('WHERE id = $1')
      expect(JSON.stringify(logs()[0]?.attributes)).not.toContain(event.data.id)
      expect(logs()[0]?.spanContext).toEqual(
        span('SELECT events.events').spanContext(),
      )
    }))

test('failed SQL still logs the statement without error details or parameters', () =>
  given(anApplication)
    .when(() =>
      Result.tryPromise(
        () =>
          postgresQuery(
            'SELECT',
            'missing_table',
            () =>
              loggedSql(
                persistence.database.sql,
              )`SELECT * FROM missing_table WHERE id = ${'private-value'}`,
          ),
        (cause) => cause,
      ),
    )
    .then((result, { logs, span }) => {
      expect(Result.isFailure(result)).toBe(true)
      expect(logs()).toHaveLength(1)
      expect(logs()[0]?.attributes['db.query.text']).toBe(
        'SELECT * FROM missing_table WHERE id = $1',
      )
      expect(JSON.stringify(logs()[0]?.attributes)).not.toContain(
        'private-value',
      )
      expect(logs()[0]?.spanContext).toEqual(
        span('SELECT missing_table').spanContext(),
      )
      expect(span('SELECT missing_table').status.code).toBe(
        SpanStatusCode.ERROR,
      )
    }))

test('SQL parameters and message contents are absent from exported spans', () =>
  given(anApplication)
    .when(({ commitEventAndMessage }) => commitEventAndMessage())
    .then((_result, { exportedSpanData, event, message }) => {
      expect(exportedSpanData()).not.toContain(event.data.title)
      expect(exportedSpanData()).not.toContain(event.data.id)
      expect(exportedSpanData()).not.toContain(message.messageId)
    }))
