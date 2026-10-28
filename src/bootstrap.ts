import { RedisClient, SQL } from 'bun'
import { createApp } from '#/app.ts'
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
function createPersistence(
  backend: 'postgres' | 'valkey' | 'valkey-functional',
) {
  if (backend === 'postgres') {
    const sql = new SQL(
      process.env.DATABASE_URL ??
        'postgres://events:events@localhost:55432/events',
    )
    return {
      repository: new PostgresEventRepository(sql),
      close: () => sql.close(),
    }
  }
  const valkey = new RedisClient(
    process.env.VALKEY_URL ?? 'redis://localhost:56379',
  )
  const Repository =
    backend === 'valkey-functional'
      ? FunctionalValkeyEventRepository
      : ValkeyEventRepository
  return {
    repository: new Repository(valkey, {
      users: new Set([
        UserId.makeUnsafe('01900000-0000-7000-8000-000000000001'),
        UserId.makeUnsafe('01900000-0000-7000-8000-000000000002'),
      ]),
      venues: new Set([
        VenueId.makeUnsafe('01900000-0000-7000-8000-000000000003'),
      ]),
    }),
    close: () => valkey.close(),
  }
}

const persistence = createPersistence(backend)
const port = Number(process.env.PORT ?? 3000)
const app = createApp(persistence.repository)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  fetch: app.fetch,
})
console.log(`Events API listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  await persistence.close()
  process.exit(0)
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
