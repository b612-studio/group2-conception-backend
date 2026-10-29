import type { Context } from 'hono'
import type { Services } from '#/application/services.ts'
import { httpFailure } from '#/controllers/http-result.ts'
import { presentReservation } from '#/presentation/event-presenter.ts'
import { requestUser } from '#/request.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

export function createUserQueryController({
  read,
  identity,
}: Pick<Services, 'read' | 'identity'>) {
  return {
    reservations: async (context: Context) => {
      const user = await requestUser(
        identity,
        Option.fromNullable(context.req.header('X-User-Id')),
      )
      if (Result.isFailure(user)) {
        return httpFailure(context, user.error)
      }
      const reservations = await read.reservationsFor.execute(user.value)
      return context.json(
        (reservations).map(
          presentReservation,
        ),
      )
    },
  }
}
export type UserQueryController = ReturnType<typeof createUserQueryController>
