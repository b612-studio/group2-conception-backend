import { createContainer } from '#/composition-root.ts'
import { createPersistence } from '#/features/events/infrastructure/persistence.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { SQL } from 'bun'
import { PostgresNotificationRepository } from '#/features/notifications/infrastructure/postgres-notification-repository.ts'

const persistence = createPersistence(
  process.env.EVENT_REPOSITORY ?? 'postgres',
)
// Both contexts use one database, but each adapter owns its schema and model.
const notificationSql = new SQL(
  process.env.DATABASE_URL ?? 'postgres://events:events@localhost:55432/events',
)
const container = createContainer({
  repository: persistence.repository,
  notificationRepository: new PostgresNotificationRepository(notificationSql),
})
const app = container.resolve(TOKEN.App)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
})
console.log(`Events API listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  container.resolve(TOKEN.NotificationSubscription)()
  await persistence.close()
  await notificationSql.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
