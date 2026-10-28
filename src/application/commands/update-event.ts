import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { Result } from '#/shared-kernel/result.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { Event, EventInput } from '#/domain/event.ts'
import type { EventId } from '#/domain/ids.ts'
import type { Clock, EventRepository } from '#/application/ports.ts'

export interface UpdateEventCommand {
  id: EventId
  patch: Partial<EventInput>
}

export class UpdateEventUseCase implements CommandHandler<
  UpdateEventCommand,
  Result<Event, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
  ) {}

  execute({ id, patch }: UpdateEventCommand) {
    return this.repository.updateEvent(id, (event, seats) =>
      event.update(patch, seats, this.clock.now()),
    )
  }
}
