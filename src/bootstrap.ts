import { RedisClient, SQL } from 'bun'
import { createApp } from '#/app.ts'
import { createServices } from '#/application/services.ts'
import { PostgresEventRepository } from '#/infrastructure/repository/postgres-event-repository.ts'
import { ValkeyEventRepository } from '#/infrastructure/repository/valkey-event-repository.ts'
import { FunctionalValkeyEventRepository } from '#/infrastructure/repository/valkey-event-repository-functional.ts'
import { UserId, VenueId } from '#/domain/ids.ts'
import {
  createKyselyDatabase,
  KyselyEventRepository,
} from '#/infrastructure/repository/kysely-event-repository.ts'
import {
  createDrizzleDatabase,
  DrizzleEventRepository,
} from '#/infrastructure/repository/drizzle-event-repository.ts'

const backend = process.env.EVENT_REPOSITORY ?? 'postgres'
if (
  backend !== 'postgres' &&
  backend !== 'kysely' &&
  backend !== 'drizzle' &&
  backend !== 'valkey' &&
  backend !== 'valkey-functional'
) {
  throw new Error(
    'EVENT_REPOSITORY must be postgres, kysely, drizzle, valkey or valkey-functional',
  )
}
function createPersistence(
  backend: 'postgres' | 'kysely' | 'drizzle' | 'valkey' | 'valkey-functional',
) {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://events:events@localhost:55432/events'
  if (backend === 'kysely') {
    const db = createKyselyDatabase(databaseUrl)
    return {
      repository: new KyselyEventRepository(db),
      close: () => db.destroy(),
    }
  }
  if (backend === 'drizzle') {
    const { db, close } = createDrizzleDatabase(databaseUrl)
    return { repository: new DrizzleEventRepository(db), close }
  }
  if (backend === 'postgres') {
    const sql = new SQL(databaseUrl)
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
const services = createServices(persistence.repository)
const port = Number(process.env.PORT ?? 3000)
const app = createApp(services)
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
