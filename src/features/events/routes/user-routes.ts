import type { Hono } from 'hono'
import type { UserQueryController } from '#/features/events/controllers/queries/user-controller.ts'

export function userRoutes(routes: Hono, controller: UserQueryController) {
  routes.get('/me/reservations', (c) => controller.reservations(c))
  return routes
}
