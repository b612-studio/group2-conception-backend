import type { EventRepository } from '#/application/ports.ts'
import type { Event } from '#/domain/event.ts'
import type { EventId } from '#/domain/ids.ts'
import { NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class GetEventUseCase implements QueryHandler<
  EventId,
  Result<Event, NotFound>
> {
  constructor(private readonly repository: EventRepository) {}

  async execute(id: EventId) {
    const event = await this.repository.findEvent(id)
    if (Option.isNone(event)) {
      return Result.fail(new NotFound('Event not found'))
    }
    return Result.succeed(event.value)
  }
}
