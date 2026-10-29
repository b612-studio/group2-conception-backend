import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import type { EventInput } from '#/domain/event.ts'
import type { EventId, ReservationId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { requestUser } from '#/request.ts'
import {
  httpError,
  httpFailure,
  httpResult,
} from '#/controllers/http-result.ts'
import {
  presentEvent,
  presentReservation,
} from '#/presentation/event-presenter.ts'
import { HttpStatusCode } from '#/presentation/http-code.ts'

export function createEventCommandController({
  identity,
  create,
  update,
  reserve,
  cancel,
}: Pick<Services, 'identity' | 'create' | 'update' | 'reserve' | 'cancel'>) {
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
