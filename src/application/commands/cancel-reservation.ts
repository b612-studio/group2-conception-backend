import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { Result } from '#/shared-kernel/result.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type {
  ApplicationError,
  Clock,
  EventRepository,
} from '#/application/ports.ts'
import type { ReservationId, UserId } from '#/domain/ids.ts'

export interface CancelReservationCommand {
  id: ReservationId
  userId: UserId
}

export class CancelReservationUseCase implements CommandHandler<
  CancelReservationCommand,
  Result<Reservation, ApplicationError>
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
  ) {}

  execute({ id, userId }: CancelReservationCommand) {
    return this.repository.cancelReservation(id, userId, (reservation) =>
      reservation.cancel(this.clock.now()),
    )
  }
}
