import { SQL } from 'bun'
import { MongoClient } from 'mongodb'
import { createContainer } from '#/composition-root.ts'
import { TOKEN } from '#/platform/di/tokens.ts'
import { PostgresEventRepository } from '#/features/events/infrastructure/repository/postgres-event-repository.ts'
import { PostgresEventsUnitOfWork } from '#/features/events/infrastructure/postgres-events-unit-of-work.ts'
import { PostgresOutboxStore } from '#/features/events/infrastructure/postgres-outbox-store.ts'
import { MongoDBEventReadRepository } from '#/features/events/infrastructure/repository/mongodb-read-event-repository.ts'
import { PostgresNotificationRepository } from '#/features/notifications/infrastructure/postgres-notification-repository.ts'

const sql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
const mongo = new MongoClient(
  process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:57017/events_read_model',
)
try {
  const container = createContainer({
    // No HTTP server or sessions are created by this script.
    applicationSecretKey: process.env.APPLICATION_SECRET_KEY ?? '',
    repository: new PostgresEventRepository(sql),
    unitOfWork: new PostgresEventsUnitOfWork(sql),
    outboxStore: new PostgresOutboxStore(sql),
    readRepository: new MongoDBEventReadRepository(mongo.db()),
    notificationRepository: new PostgresNotificationRepository(sql),
  })
  console.log(
    `Delivered ${await container.resolve(TOKEN.OutboxDispatcher).drain(Number(process.argv[2] ?? 100))} messages`,
  )
} finally {
  await Promise.all([mongo.close(), sql.close()])
}
