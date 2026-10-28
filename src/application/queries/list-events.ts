import type { EventFilter, EventRepository } from '#/application/ports.ts'
import type { Event } from '#/domain/event.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class ListEventsUseCase implements QueryHandler<EventFilter, Event[]> {
  constructor(private readonly repository: EventRepository) {}

  execute(query: EventFilter) {
    return this.repository.listEvents(query)
  }
}
