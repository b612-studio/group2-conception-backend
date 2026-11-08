import type { SQL } from 'bun'
import { loggedSql } from '#/platform/observability/logged-sql.ts'
import {
  measureOutboxAttempt,
  recordOutboxMessageAge,
} from '#/platform/observability/operation-metrics.ts'
import { propagation, ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api'
import { inSpan, postgresQuery } from '#/platform/observability/spans.ts'
import * as v from 'valibot'
import type { OutboxStore } from '#/features/events/application/ports.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

const date = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((value) => new Date(value)),
)
const eventDetails = v.object({
  eventId: v.string(),
  title: v.string(),
  category: v.string(),
  startsAt: date,
  capacity: v.number(),
  venueId: v.string(),
})
const reservationDetails = v.object({
  reservationId: v.string(),
  eventId: v.string(),
  userId: v.string(),
  quantity: v.number(),
})
const envelopeSchema = v.object({
  messageId: v.string(),
  occurredAt: date,
  version: v.literal(1),
  traceContext: v.optional(
    v.object({
      traceparent: v.optional(v.string()),
      tracestate: v.optional(v.string()),
    }),
  ),
  event: v.variant('_tag', [
    v.object({ _tag: v.literal('EventCreated'), content: eventDetails }),
    v.object({ _tag: v.literal('EventUpdated'), content: eventDetails }),
    v.object({ _tag: v.literal('EventReserved'), content: reservationDetails }),
    v.object({
      _tag: v.literal('ReservationCancelled'),
      content: reservationDetails,
    }),
  ]),
})

export class PostgresOutboxStore implements OutboxStore {
  constructor(private readonly sql: SQL) {}

  async deliverNext(
    deliver: (envelope: EventEnvelope<DomainEvent>) => Promise<void>,
  ): Promise<boolean> {
    return inSpan('outbox.deliverNext', () =>
      measureOutboxAttempt(() =>
        inSpan('postgres.transaction', () =>
          this.sql.begin(async (tx) => {
            const [row] = await postgresQuery(
              'SELECT',
              'events.outbox',
              () => loggedSql(tx)<{ sequence: string; envelope: unknown }[]>`
        SELECT sequence, envelope FROM events.outbox
        WHERE published_at IS NULL ORDER BY sequence LIMIT 1 FOR UPDATE SKIP LOCKED`,
            )
            if (!row) {
              return false
            }
            const { traceContext, ...envelope } = v.parse(
              envelopeSchema,
              row.envelope,
            )
            recordOutboxMessageAge(envelope.occurredAt)
            const producer = trace.getSpanContext(
              propagation.extract(ROOT_CONTEXT, traceContext ?? {}),
            )
            // A drain can process messages from many requests. Keep the worker parent
            // and link each delivery to its producer rather than reparenting the batch.
            await inSpan('outbox.process', () => deliver(envelope), {
              kind: SpanKind.CONSUMER,
              links: producer ? [{ context: producer }] : [],
              attributes: {
                'messaging.system': 'postgresql',
                'messaging.destination.name': 'events.outbox',
              },
            })
            await postgresQuery(
              'UPDATE',
              'events.outbox',
              () =>
                loggedSql(tx)`UPDATE events.outbox SET published_at = now() WHERE sequence = ${row.sequence}`,
            )
            return true
          }),
        ),
      ),
    )
  }
}
