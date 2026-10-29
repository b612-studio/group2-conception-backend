import type { CommandHandler } from '#/shared-kernel/command-handler.ts'
import type { ApplicationError } from '#/application/ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { domainEvent, type ApplicationEvent } from '#/domain/domain-events.ts'
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
    private readonly eventBus: EventBus<ApplicationEvent>,
  ) {}

  async execute(input: ReserveEventCommand) {
    const result = await this.repository.reserve(
      input.eventId,
      (event, seats) => {
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
      },
    )
    if (Result.isSuccess(result)) {
      const reservation = result.value.data
      await this.eventBus.publish(
        domainEvent(
          'EventReserved',
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
