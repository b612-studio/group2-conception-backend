import type { RedisClient } from 'bun'
import {
  repositorySpan,
  valkeyCommand,
} from '#/platform/observability/spans.ts'
import * as v from 'valibot'
import type {
  EventFilter,
  EventProjectionRepository,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import {
  eventToDomain,
  eventToEntity,
} from '#/features/events/infrastructure/event-entity.ts'
import { matchesEventFilter } from '#/features/events/infrastructure/repository/event-predicates.ts'
import { Option } from '#/shared-kernel/option.ts'

const eventSnapshotSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.array(
    v.strictObject({
      id: v.string(),
      title: v.string(),
      category: v.string(),
      starts_at: v.pipe(v.string(), v.isoTimestamp(), v.toDate()),
      capacity: v.number(),
      venue_id: v.string(),
    }),
  ),
)

// A separate, disposable read model. SET replaces the snapshot atomically, so
// readers never observe a partially rebuilt projection. No booking writes here.
export class ValkeyEventReadRepository implements EventProjectionRepository {
  constructor(
    private readonly client: RedisClient,
    private readonly key = 'events:read-model:v1',
  ) {}

  async replaceEvents(events: readonly Event[]): Promise<void> {
    await repositorySpan(
      'EventProjectionRepository.replaceEvents',
      async () => {
        const snapshot = JSON.stringify(events.map(eventToEntity))
        await valkeyCommand('SET', () => this.client.set(this.key, snapshot))
      },
    )
  }

  async listEvents(filter: EventFilter) {
    return repositorySpan('EventProjectionRepository.listEvents', async () =>
      (await this.read())
        .filter(matchesEventFilter(filter))
        .sort(
          (a, b) =>
            a.data.startsAt.getTime() - b.data.startsAt.getTime() ||
            a.data.id.localeCompare(b.data.id),
        ),
    )
  }

  async findEvent(id: EventId) {
    return repositorySpan('EventProjectionRepository.findEvent', async () =>
      Option.fromNullable(
        (await this.read()).find(({ data }) => data.id === id),
      ),
    )
  }

  private async read(): Promise<Event[]> {
    const raw = await valkeyCommand('GET', () => this.client.get(this.key))
    if (raw === null) {
      return []
    }
    return v.parse(eventSnapshotSchema, raw).map(eventToDomain)
  }
}
