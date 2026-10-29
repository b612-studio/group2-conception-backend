import type { Clock, EventRepository } from '#/application/ports.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { domainEvent, type ApplicationEvent } from '#/domain/domain-events.ts'
import type { UserId } from '#/domain/ids.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class ListReservationsUseCase implements QueryHandler<
  UserId,
  Reservation[]
> {
  constructor(
    private readonly repository: EventRepository,
    private readonly clock: Clock,
    private readonly eventBus: EventBus<ApplicationEvent>,
  ) {}

  async execute(userId: UserId) {
    const reservations = await this.repository.listReservations(userId)
    await this.eventBus.publish(
      domainEvent(
        'ReservationsListed',
        { userId, count: reservations.length },
        this.clock.now(),
      ),
    )
    return reservations
  }
}
