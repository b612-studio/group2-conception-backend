import type { Hono } from 'hono'
import { Hono as Router } from 'hono'
import * as v from 'valibot'
import { createMiddleware } from 'hono/factory'
import type { NotificationService } from '#/features/notifications/application/notification-service.ts'
import type { Recipient } from '#/features/notifications/domain/notification.ts'
import { Option } from '#/shared-kernel/option.ts'
import { HttpStatusCode } from '#/infrastructure/http/http-code.ts'

// Independent HTTP boundary. It does not use Events' identity service or schemas.
const uuid = v.pipe(
  v.string(),
  v.regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
)
const preferences = v.strictObject({ inboxEnabled: v.boolean() })

export function notificationRoutes(app: Hono, service: NotificationService) {
  const routes = new Router<{ Variables: { recipient: Recipient } }>()
  const identify = createMiddleware<{ Variables: { recipient: Recipient } }>(
    async (c, next) => {
      const header = c.req.header('X-User-Id')
      if (header === undefined) {
        return c.json(
          { error: { code: 'UNAUTHORIZED', message: 'X-User-Id is required' } },
          HttpStatusCode.Unauthorized,
        )
      }
      const parsed = v.safeParse(uuid, header)
      if (!parsed.success) {
        return c.json(
          {
            error: {
              code: 'INVALID_INPUT',
              message: 'Expected a lowercase UUID v7',
            },
          },
          HttpStatusCode.BadRequest,
        )
      }
      const recipient = await service.recipient(parsed.output)
      if (Option.isNone(recipient)) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Recipient is not enrolled',
            },
          },
          HttpStatusCode.Unauthorized,
        )
      }
      c.set('recipient', recipient.value)
      await next()
    },
  )
  routes.use('/me/notifications', identify)
  routes.use('/me/notifications/*', identify)
  routes.use('/me/notification-preferences', identify)
  routes.get('/me/notifications', async (c) =>
    c.json(await service.inbox(c.get('recipient').id), HttpStatusCode.Ok),
  )
  routes.get('/me/notification-preferences', (c) =>
    c.json(
      { inboxEnabled: c.get('recipient').inboxEnabled },
      HttpStatusCode.Ok,
    ),
  )
  routes.patch('/me/notification-preferences', async (c) => {
    let input: unknown
    try {
      input = await c.req.json()
    } catch {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Request body must be valid JSON',
          },
        },
        HttpStatusCode.BadRequest,
      )
    }
    const parsed = v.safeParse(preferences, input)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Expected inboxEnabled boolean only',
          },
        },
        HttpStatusCode.BadRequest,
      )
    }
    const updated = await service.preferences(
      c.get('recipient').id,
      parsed.output.inboxEnabled,
    )
    return c.json({ inboxEnabled: updated.inboxEnabled }, HttpStatusCode.Ok)
  })
  routes.post('/me/notifications/:notificationId/read', async (c) => {
    const id = v.safeParse(uuid, c.req.param('notificationId'))
    if (!id.success) {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Expected a lowercase UUID v7',
          },
        },
        HttpStatusCode.BadRequest,
      )
    }
    const notification = await service.markRead(
      c.get('recipient').id,
      id.output,
    )
    if (Option.isNone(notification)) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Notification not found' } },
        HttpStatusCode.NotFound,
      )
    }
    return c.json(notification.value, HttpStatusCode.Ok)
  })
  app.route('/', routes)
}
