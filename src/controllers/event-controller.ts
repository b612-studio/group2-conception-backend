import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import type { EventFilter } from '#/application/ports.ts'
import type { EventInput } from '#/domain/event.ts'
import type { EventId, ReservationId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import { requestUser } from '#/request.ts'
import { httpFailure, httpResult } from '#/controllers/http-result.ts'

export function createEventController({
  read,
  identity,
  create,
  update,
  reserve,
  cancel,
}: Services) {
  const currentUser = (context: Context) =>
    requestUser(identity, Option.fromNullable(context.req.header('X-User-Id')))
  return {
    list: async (context: Context, filter: EventFilter) =>
      context.json((await read.list(filter)).map((event) => event.data)),
    get: async (context: Context, id: EventId) =>
      httpResult(context, await read.get(id), (event) => event.data),
    create: async (context: Context, input: EventInput) => {
      const result = await create.execute(input)
      if (result._tag === 'Success') {
        context.header('Location', `/events/${result.value.data.id}`)
      }
      return httpResult(context, result, (event) => event.data, 201)
    },
    update: async (context: Context, id: EventId, patch: Partial<EventInput>) =>
      httpResult(
        context,
        await update.execute(id, patch),
        (event) => event.data,
      ),
    reserve: async (context: Context, eventId: EventId, quantity: number) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await reserve.execute({ eventId, userId: user.value, quantity }),
        (reservation) => ({
          ...reservation.data,
          cancelledAt: Option.match(reservation.data.cancelledAt, {
            onNone: () => null,
            onSome: (date) => date,
          }),
        }),
        201,
      )
    },
    cancel: async (context: Context, id: ReservationId) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await cancel.execute(id, user.value),
        (reservation) => ({
          ...reservation.data,
          cancelledAt: Option.match(reservation.data.cancelledAt, {
            onNone: () => null,
            onSome: (date) => date,
          }),
        }),
      )
    },
  }
}
export type EventController = ReturnType<typeof createEventController>
