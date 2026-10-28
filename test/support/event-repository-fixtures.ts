import { RedisClient, SQL } from 'bun'
import { GenericContainer, Wait } from 'testcontainers'
import type { EventRepository } from '#/domain/event-repository.ts'
import { UserId, VenueId } from '#/domain/ids.ts'
import { InMemoryEventRepository } from '#/infrastructure/in-memory-event-repository.ts'
import { PostgresEventRepository } from '#/infrastructure/postgres-event-repository.ts'
import { ValkeyEventRepository } from '#/infrastructure/valkey-event-repository.ts'

// The same reference records are provided to every adapter.
export const alice = UserId.makeUnsafe('01900000-0000-7000-8000-000000000001')
export const bob = UserId.makeUnsafe('01900000-0000-7000-8000-000000000002')
export const venueId = VenueId.makeUnsafe(
  '01900000-0000-7000-8000-000000000003',
)
const references = { users: new Set([alice, bob]), venues: new Set([venueId]) }

export interface RepositoryFixture {
  repository: EventRepository
  // Independent client sharing the same data, or the same instance for memory.
  peer: EventRepository
  reset(): Promise<void>
  close(): Promise<void>
}

async function inMemory(): Promise<RepositoryFixture> {
  let repository = new InMemoryEventRepository(references)
  return {
    get repository() {
      return repository
    },
    get peer() {
      return repository
    },
    async reset() {
      repository = new InMemoryEventRepository(references)
    },
    async close() {},
  }
}

async function postgres(): Promise<RepositoryFixture> {
  const container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'events',
      POSTGRES_USER: 'events',
      POSTGRES_PASSWORD: 'events',
    })
    .withExposedPorts(5432)
    .withHealthCheck({
      test: ['CMD-SHELL', 'pg_isready -U events -d events'],
      interval: 1000,
      timeout: 3000,
      retries: 30,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start()
  const url = `postgres://events:events@${container.getHost()}:${container.getMappedPort(5432)}/events`
  // init.sql contains BEGIN/COMMIT, so initialization stays on one connection.
  const sql = new SQL(url, { max: 1 })
  const peer = new SQL(url)
  const close = async () => {
    try {
      await Promise.all([sql.close(), peer.close()])
    } finally {
      await container.stop()
    }
  }
  try {
    await sql.unsafe(
      await Bun.file(new URL('../../sql/init.sql', import.meta.url)).text(),
    )
    return {
      repository: new PostgresEventRepository(sql),
      peer: new PostgresEventRepository(peer),
      async reset() {
        await sql`TRUNCATE reservations, events`
      },
      close,
    }
  } catch (cause) {
    await close()
    throw cause
  }
}

async function valkey(): Promise<RepositoryFixture> {
  const container = await new GenericContainer('valkey/valkey:alpine')
    .withExposedPorts(6379)
    .withHealthCheck({
      test: ['CMD', 'valkey-cli', 'ping'],
      interval: 1000,
      timeout: 3000,
      retries: 30,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start()
  const url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`
  const client = new RedisClient(url)
  const peer = new RedisClient(url)
  const key = 'contract:events:v1'
  return {
    repository: new ValkeyEventRepository(client, references, key),
    peer: new ValkeyEventRepository(peer, references, key),
    async reset() {
      await client.del(key)
    },
    async close() {
      try {
        client.close()
        peer.close()
      } finally {
        await container.stop()
      }
    },
  }
}

export const repositoryFactories: {
  name: string
  create: () => Promise<RepositoryFixture>
}[] = [
  { name: 'in-memory', create: inMemory },
  { name: 'PostgreSQL', create: postgres },
  { name: 'Valkey', create: valkey },
]
