import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import { Result } from '#/shared-kernel/result.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { DomainEvent } from '#/domain/domain-events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type {
  ApplicationError,
  Clock,
  EventRepository,
  IdGenerator,
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
    private readonly ids: IdGenerator,
    private readonly eventBus: EventBus<EventEnvelope<DomainEvent>>,
  ) {}

  async execute({ id, userId }: CancelReservationCommand) {
    const result = await this.repository.cancelReservation(
      id,
      userId,
      (reservation) => reservation.cancel(this.clock.now()),
    )
    if (Result.isSuccess(result)) {
      const reservation = result.value.data
      await this.eventBus.publish({
        messageId: this.ids.next<string>(),
        occurredAt: this.clock.now(),
        version: 1,
        event: {
          type: 'ReservationCancelled',
          content: {
            reservationId: reservation.id,
            eventId: reservation.eventId,
            userId: reservation.userId,
            quantity: reservation.quantity,
          },
        },
      })
    }
    return result
  }
}
