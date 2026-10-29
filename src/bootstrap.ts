import { createContainer } from '#/composition-root.ts'
import { createPersistence } from '#/infrastructure/persistence.ts'
import { TOKEN } from '#/tokens.ts'

const persistence = createPersistence(
  process.env.EVENT_REPOSITORY ?? 'postgres',
)
const container = createContainer({ repository: persistence.repository })
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
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
