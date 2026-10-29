import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { ApplicationError } from '#/application/ports.ts'
import { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId, UserId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'

export interface ReserveEventCommand {
  eventId: EventId
  userId: UserId
  quantity: number
}

export class ReserveEventUseCase implements CommandHandler<
  ReserveEventCommand,
  Result<Reservation, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) { }

  execute(input: ReserveEventCommand) {
    return this.repository.reserve(input.eventId, (event, seats) => {
      const now = this.clock.now()
      const checked = event.checkReservation(input.quantity, seats, now)
      if (Result.isFailure(checked)) {
        return checked
      }
      return Result.succeed(
        new Reservation({
          ...input,
          id: this.ids.next<ReservationId>(),
          createdAt: now,
          cancelledAt: Option.none(),
        }),
      )
    })
  }
}
