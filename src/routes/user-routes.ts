import type { Hono } from 'hono'
import type { UserQueryController } from '#/controllers/queries/user-controller.ts'

export function userRoutes(routes: Hono, controller: UserQueryController) {
  routes.get('/me/reservations', (c) => controller.reservations(c))
  return routes
}
