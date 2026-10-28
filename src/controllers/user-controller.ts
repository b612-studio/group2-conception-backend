import type { Context } from 'hono'
import type { EventRepository } from '#/domain/event-repository.ts'
import { httpFailure } from '#/controllers/http-result.ts'
import { requestUser } from '#/request.ts'
import { Option } from '#/shared-kernel/option.ts'

export function createUserController(repository: EventRepository) {
  return {
    reservations: async (context: Context) => {
      const user = await requestUser(
        repository,
        Option.fromNullable(context.req.header('X-User-Id')),
      )
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return context.json(
        (await repository.listReservations(user.value)).map((reservation) => ({
          ...reservation.data,
          cancelledAt: Option.match(reservation.data.cancelledAt, {
            onNone: () => null,
            onSome: (date) => date,
          }),
        })),
      )
    },
  }
}
export type UserController = ReturnType<typeof createUserController>
