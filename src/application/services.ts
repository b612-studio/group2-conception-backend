import { CreateEventUseCase } from '#/application/commands/create-event.ts'
import { UpdateEventUseCase } from '#/application/commands/update-event.ts'
import { ReserveEventUseCase } from '#/application/commands/reserve-event.ts'
import { CancelReservationUseCase } from '#/application/commands/cancel-reservation.ts'
import { ListEventsUseCase } from '#/application/queries/list-events.ts'
import { GetEventUseCase } from '#/application/queries/get-event.ts'
import { ListReservationsUseCase } from '#/application/queries/list-reservations.ts'
import { DemoIdentity } from '#/application/demo-identity.ts'
import { makeId } from '#/domain/ids.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'

export function createServices(
  repository: EventRepository,
  clock: Clock = { now: () => new Date() },
  ids: IdGenerator = { next: makeId },
) {
  return {
    read: {
      list: new ListEventsUseCase(repository),
      get: new GetEventUseCase(repository),
      reservationsFor: new ListReservationsUseCase(repository),
    },
    identity: new DemoIdentity(repository),
    create: new CreateEventUseCase(repository, clock, ids),
    update: new UpdateEventUseCase(repository, clock),
    reserve: new ReserveEventUseCase(repository, clock, ids),
    cancel: new CancelReservationUseCase(repository, clock),
  }
}

export type Services = ReturnType<typeof createServices>
