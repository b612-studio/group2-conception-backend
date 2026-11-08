import { RedisClient, SQL } from 'bun'
import { startTelemetry } from '#/platform/observability/telemetry.ts'
import { inSpan } from '#/platform/observability/spans.ts'
import { otelNotificationLogger } from '#/features/notifications/infrastructure/otel-notification-logger.ts'
import { createContainer } from '#/composition-root.ts'
import { TOKEN } from '#/platform/di/tokens.ts'
import { PostgresEventRepository } from '#/features/events/infrastructure/repository/postgres-event-repository.ts'
import { PostgresEventsUnitOfWork } from '#/features/events/infrastructure/postgres-events-unit-of-work.ts'
import { PostgresOutboxStore } from '#/features/events/infrastructure/postgres-outbox-store.ts'
import { ValkeyEventReadRepository } from '#/features/events/infrastructure/repository/valkey-event-read-repository.ts'
import { PostgresNotificationRepository } from '#/features/notifications/infrastructure/postgres-notification-repository.ts'

const telemetry = startTelemetry()
const sql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
const redis = new RedisClient(
  process.env.VALKEY_URL ?? 'redis://localhost:56379',
)
try {
  const container = createContainer({
    // No HTTP server or sessions are created by this script.
    applicationSecretKey: process.env.APPLICATION_SECRET_KEY ?? '',
    repository: new PostgresEventRepository(sql),
    unitOfWork: new PostgresEventsUnitOfWork(sql),
    outboxStore: new PostgresOutboxStore(sql),
    readRepository: new ValkeyEventReadRepository(redis),
    notificationRepository: new PostgresNotificationRepository(sql),
    notificationLogger: otelNotificationLogger,
  })
  const delivered = await inSpan('outbox.drain', async (span) => {
    const count = await container
      .resolve(TOKEN.OutboxDispatcher)
      .drain(Number(process.argv[2] ?? 100))
    span.setAttribute('messaging.batch.message_count', count)
    return count
  })
  console.log(`Delivered ${delivered} messages`)
} finally {
  try {
    redis.close()
    await sql.close()
  } finally {
    await telemetry.shutdown()
  }
}
