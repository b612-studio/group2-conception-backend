import type { EventRepository } from '#/application/ports.ts'
import type { UserId } from '#/domain/ids.ts'
import type { Reservation } from '#/domain/reservation.ts'
import type { QueryHandler } from '#/shared-kernel/query-handler.ts'

export class ListReservationsUseCase implements QueryHandler<
  UserId,
  Reservation[]
> {
  constructor(private readonly repository: EventRepository) {}

  execute(userId: UserId) {
    return this.repository.listReservations(userId)
  }
}
