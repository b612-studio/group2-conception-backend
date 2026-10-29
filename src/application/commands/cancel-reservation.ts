import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { domainEvent, type ApplicationEvent } from '#/domain/domain-events.ts'
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
    private readonly eventBus: EventBus<ApplicationEvent>,
  ) {}

  async execute({ id, userId }: CancelReservationCommand) {
    const result = await this.repository.cancelReservation(
      id,
      userId,
      (reservation) => reservation.cancel(this.clock.now()),
    )
    if (Result.isSuccess(result)) {
      const reservation = result.value.data
      await this.eventBus.publish(
        domainEvent(
          'ReservationCancelled',
          {
            reservationId: reservation.id,
            eventId: reservation.eventId,
            userId: reservation.userId,
            quantity: reservation.quantity,
          },
          this.clock.now(),
        ),
      )
    }
    return result
  }
}
