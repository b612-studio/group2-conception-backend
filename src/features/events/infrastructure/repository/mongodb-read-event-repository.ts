import type { Collection, Db, Filter } from 'mongodb'
import type {
  EventFilter,
  EventProjectionRepository,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { EventId } from '#/features/events/domain/ids.ts'
import {
  type EventEntity,
  eventToDomain,
  eventToEntity,
} from '#/features/events/infrastructure/event-entity.ts'
import { Option } from '#/shared-kernel/option.ts'

type EventDocument = Omit<EventEntity, 'id'> & { _id: string }

function toDomain({ _id, ...fields }: EventDocument): Event {
  return eventToDomain({ id: _id, ...fields })
}

function toDocument(event: Event): EventDocument {
  const { id, ...fields } = eventToEntity(event)
  return { _id: id, ...fields }
}

export class MongoDBEventReadRepository implements EventProjectionRepository {
  private readonly events: Collection<EventDocument>

  constructor(db: Db) {
    this.events = db.collection<EventDocument>('events')
  }

  async listEvents({ category, after }: EventFilter): Promise<Event[]> {
    const filter: Filter<EventDocument> = {}
    if (category !== undefined) {
      filter.category = category
    }
    if (after !== undefined) {
      filter.starts_at = { $gt: after }
    }
    const documents = await this.events
      .find(filter)
      .sort({ starts_at: 1, _id: 1 })
      .toArray()
    return documents.map(toDomain)
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const document = await this.events.findOne({ _id: id })
    return document === null ? Option.none() : Option.some(toDomain(document))
  }

  async upsertEvent(event: Event): Promise<void> {
    await this.events.replaceOne({ _id: event.data.id }, toDocument(event), {
      upsert: true,
    })
  }

  // Reconcile with the write store at startup, before serving queries.
  async replaceEvents(events: readonly Event[]): Promise<void> {
    await this.events.createIndexes([
      { key: { starts_at: 1, _id: 1 } },
      { key: { category: 1, starts_at: 1, _id: 1 } },
    ])
    if (events.length > 0) {
      await this.events.bulkWrite(
        events.map((event) => ({
          replaceOne: {
            filter: { _id: event.data.id },
            replacement: toDocument(event),
            upsert: true,
          },
        })),
      )
    }
    await this.events.deleteMany({
      _id: { $nin: events.map(({ data }) => data.id) },
    })
  }
}
