import { Event, type EventInput } from '#/domain/event.ts'
import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { EventId } from '#/domain/ids.ts'
import { InvalidInput } from '#/domain/errors.ts'
import { Result } from '#/shared-kernel/result.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { DomainEvent } from '#/domain/domain-events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export class CreateEventUseCase implements CommandHandler<
  EventInput,
  Result<Event, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly eventBus: EventBus<EventEnvelope<DomainEvent>>,
  ) {}

  async execute(input: EventInput) {
    const result = Event.create({ ...input, id: this.ids.next<EventId>() })
    const now = this.clock.now()
    if (Result.isFailure(result)) {
      return result
    }
    if (result.value.data.startsAt <= now) {
      return Result.fail(new InvalidInput('Event must start in the future'))
    }
    const persisted = await this.repository.createEvent(result.value)
    if (Result.isSuccess(persisted)) {
      const success = persisted.value.data
      await this.eventBus.publish({
        messageId: this.ids.next<string>(),
        occurredAt: now,
        version: 1,
        event: {
          type: 'EventCreated',
          content: {
            eventId: success.id,
            title: success.title,
            category: success.category,
            startsAt: success.startsAt,
            capacity: success.capacity.value,
            venueId: success.venueId,
          },
        },
      })
    }
    return persisted
  }
}
