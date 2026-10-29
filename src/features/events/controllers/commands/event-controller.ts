import type { Context } from 'hono'
import type { DemoIdentity } from '#/features/events/application/demo-identity.ts'
import type { CreateEventUseCase } from '#/features/events/application/commands/create-event.ts'
import type { UpdateEventUseCase } from '#/features/events/application/commands/update-event.ts'
import type { ReserveEventUseCase } from '#/features/events/application/commands/reserve-event.ts'
import type { CancelReservationUseCase } from '#/features/events/application/commands/cancel-reservation.ts'
import type { EventInput } from '#/features/events/domain/event.ts'
import type { EventId, ReservationId } from '#/features/events/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { requestUser } from '#/features/events/request.ts'
import {
  httpError,
  httpFailure,
  httpResult,
} from '#/features/events/controllers/http-result.ts'
import {
  presentEvent,
  presentReservation,
} from '#/features/events/presentation/event-presenter.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'

export function createEventCommandController({
  identity,
  create,
  update,
  reserve,
  cancel,
}: {
  identity: DemoIdentity
  create: CreateEventUseCase
  update: UpdateEventUseCase
  reserve: ReserveEventUseCase
  cancel: CancelReservationUseCase
}) {
  const currentUser = (context: Context) =>
    requestUser(identity, Option.fromNullable(context.req.header('X-User-Id')))
  return {
    create: async (context: Context, input: EventInput) => {
      const result = await create.execute(input)
      if (Result.isSuccess(result)) {
        context.header('Location', `/events/${result.value.data.id}`)
      } else {
        return httpError(context, result)
      }
      return httpResult(context, result, presentEvent, HttpStatusCode.Created)
    },
    update: async (context: Context, id: EventId, patch: Partial<EventInput>) =>
      httpResult(context, await update.execute({ id, patch }), presentEvent),
    reserve: async (context: Context, eventId: EventId, quantity: number) => {
      const user = await currentUser(context)
      if (Result.isFailure(user)) {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await reserve.execute({ eventId, userId: user.value, quantity }),
        presentReservation,
        HttpStatusCode.Created,
      )
    },
    cancel: async (context: Context, id: ReservationId) => {
      const user = await currentUser(context)
      if (Result.isFailure(user)) {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await cancel.execute({ id, userId: user.value }),
        presentReservation,
      )
    },
  }
}
export type EventCommandController = ReturnType<
  typeof createEventCommandController
>
