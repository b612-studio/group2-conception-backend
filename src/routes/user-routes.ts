import { Hono } from 'hono'
import type { UserQueryController } from '#/controllers/queries/user-controller.ts'

export function userRoutes(controller: UserQueryController) {
  const routes = new Hono()
  routes.get('/me/reservations', (c) => controller.reservations(c))
  return routes
}
