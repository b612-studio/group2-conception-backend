import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createEventController } from '#/controllers/event-controller.ts'
import { createUserController } from '#/controllers/user-controller.ts'
import { userRoutes } from '#/routes/user-routes.ts'
import type { Services } from '#/application/services.ts'
import { eventRoutes } from '#/routes/event-routes.ts'

export function createApp(services: Services) {
  const app = new Hono()
  app.route('/', eventRoutes(createEventController(services)))
  app.route('/', userRoutes(createUserController(services)))
  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
  )
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return error.getResponse()
    }
    console.error(error)
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      500,
    )
  })
  return app
}
