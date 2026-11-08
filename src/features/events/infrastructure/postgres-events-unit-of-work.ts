import type { SQL } from 'bun'
import { loggedSql } from '#/platform/observability/logged-sql.ts'
import { context, propagation } from '@opentelemetry/api'
import { inSpan, postgresQuery } from '#/platform/observability/spans.ts'
import type {
  ApplicationError,
  EventRepository,
  EventsUnitOfWork,
  OutboxWriter,
} from '#/features/events/application/ports.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { Result, type Failure } from '#/shared-kernel/result.ts'
import { PostgresEventRepository } from './repository/postgres-event-repository.ts'

// A normal return from Bun's transaction callback commits, including a Failure.
// This private signal forces rollback without exposing business failures as throws.
class RollbackResult {
  constructor(readonly result: Failure<ApplicationError>) {}
}

export class PostgresOutboxWriter implements OutboxWriter {
  constructor(private readonly tx: SQL) {}

  async append(envelope: EventEnvelope<DomainEvent>): Promise<void> {
    await inSpan('outbox.append', async () => {
      const carrier: Record<string, string> = {}
      propagation.inject(context.active(), carrier)
      // Persist W3C trace metadata only. Never persist baggage or other headers.
      const traceContext = {
        traceparent: carrier.traceparent,
        tracestate: carrier.tracestate,
      }
      const stored = { ...envelope, traceContext }
      await postgresQuery(
        'INSERT',
        'events.outbox',
        () => loggedSql(this.tx)`INSERT INTO events.outbox (message_id, envelope)
        VALUES (${envelope.messageId}, ${stored}::jsonb)`,
      )
    })
  }
}

export class PostgresEventsUnitOfWork implements EventsUnitOfWork {
  constructor(private readonly sql: SQL) {}

  async run<Value>(
    work: (scope: {
      events: EventRepository
      outbox: OutboxWriter
    }) => Promise<Result<Value, ApplicationError>>,
  ): Promise<Result<Value, ApplicationError>> {
    return inSpan('events.transaction', async (span) => {
      try {
        const result = await this.sql.begin(async (tx) => {
          const result = await work({
            events: new PostgresEventRepository(tx, true),
            outbox: new PostgresOutboxWriter(tx),
          })
          if (Result.isFailure(result)) {
            throw new RollbackResult(result)
          }
          return result
        })
        span.setAttribute('transaction.outcome', 'committed')
        return result
      } catch (cause) {
        if (cause instanceof RollbackResult) {
          span.setAttribute('transaction.outcome', 'rolled_back')
          return cause.result
        }
        span.setAttribute('transaction.outcome', 'failed')
        throw cause
      }
    })
  }
}
