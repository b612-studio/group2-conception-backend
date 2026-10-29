import type {
  Clock,
  EventFilter,
  EventRepository,
} from '#/application/ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { domainEvent, type ApplicationEvent } from '#/domain/domain-events.ts'
import type { Event } from '#/domain/event.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class ListEventsUseCase implements QueryHandler<EventFilter, Event[]> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly eventBus: EventBus<ApplicationEvent>,
  ) {}

  async execute(query: EventFilter) {
    const events = await this.repository.listEvents(query)
    await this.eventBus.publish(
      domainEvent(
        'EventsListed',
        { ...query, count: events.length },
        this.clock.now(),
      ),
    )
    return events
  }
}
