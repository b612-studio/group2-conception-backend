import { RedisClient, SQL } from 'bun'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { PostgresEventRepository } from '#/infrastructure/postgres-event-repository.ts'
import { ValkeyEventRepository } from '#/infrastructure/valkey-event-repository.ts'
import { FunctionalValkeyEventRepository } from '#/infrastructure/valkey-event-repository-functional.ts'
import { UserId, VenueId } from '#/domain/ids.ts'

const backend = process.env.EVENT_REPOSITORY ?? 'postgres'
if (
  backend !== 'postgres' &&
  backend !== 'valkey' &&
  backend !== 'valkey-functional'
) {
  throw new Error(
    'EVENT_REPOSITORY must be postgres, valkey or valkey-functional',
  )
}
const sql =
  backend === 'postgres'
    ? new SQL(
        process.env.DATABASE_URL ??
          'postgres://events:events@localhost:55432/events',
      )
    : undefined
const valkey =
  backend !== 'postgres'
    ? new RedisClient(process.env.VALKEY_URL ?? 'redis://localhost:56379')
    : undefined
const ValkeyRepository =
  backend === 'valkey-functional'
    ? FunctionalValkeyEventRepository
    : ValkeyEventRepository
const repository = valkey
  ? new ValkeyRepository(valkey, {
      users: new Set([
        UserId.makeUnsafe('01900000-0000-7000-8000-000000000001'),
        UserId.makeUnsafe('01900000-0000-7000-8000-000000000002'),
      ]),
      venues: new Set([
        VenueId.makeUnsafe('01900000-0000-7000-8000-000000000003'),
      ]),
    })
  : new PostgresEventRepository(sql!)
const services = createServices(repository)
const port = Number(process.env.PORT ?? 3000)
const app = createApp(services, {
  mcpUrl: () => process.env.MCP_URL ?? `http://127.0.0.1:${port}/mcp`,
})
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: app.fetch,
})
console.log(`Events API listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  await sql?.close()
  valkey?.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
