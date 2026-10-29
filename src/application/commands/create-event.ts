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

export class CreateEventUseCase implements CommandHandler<
  EventInput,
  Result<Event, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) { }

  async execute(input: EventInput) {
    const result = Event.create({ ...input, id: this.ids.next<EventId>() })
    if (Result.isFailure(result)) {
      return result
    }
    if (result.value.data.startsAt <= this.clock.now()) {
      return Result.fail(new InvalidInput('Event must start in the future'))
    }
    return this.repository.createEvent(result.value)
  }
}
