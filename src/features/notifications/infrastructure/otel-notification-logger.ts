import type { NotificationLogger } from './events-subscriber.ts'
import { logEvent } from '#/platform/observability/logging.ts'

export const otelNotificationLogger: NotificationLogger = {
  log: (_message, envelope) =>
    logEvent('info', 'notification.event.received', {
      'event.type': envelope.event._tag,
    }),
}
