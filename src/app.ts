import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { EventCommandController } from '#/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/controllers/queries/event-controller.ts'
import type { UserQueryController } from '#/controllers/queries/user-controller.ts'
import { userRoutes } from '#/routes/user-routes.ts'
import { eventRoutes } from '#/routes/event-routes.ts'
import { presentError } from '#/presentation/event-presenter.ts'

export function createApp(
  commands: EventCommandController,
  queries: EventQueryController,
  users: UserQueryController,
) {
  const app = new Hono()
  eventRoutes(app, commands, queries)
  userRoutes(app, users)
  app.notFound((c) => c.json(presentError('NOT_FOUND', 'Route not found'), 404))
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    console.error(error)
    return c.json(
      presentError('INTERNAL_ERROR', 'An unexpected error occurred'),
      500,
    )
  })
  return app
}
