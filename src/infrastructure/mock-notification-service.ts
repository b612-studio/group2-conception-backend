import type { ApplicationEvent } from '#/domain/domain-events.ts'

export interface NotificationLogger {
  log(message: string, event: ApplicationEvent): void
}

// Demo adapter. No email, SMS, or other external delivery.
export class MockNotificationService {
  constructor(private readonly logger: NotificationLogger) {}

  notify(event: ApplicationEvent): void {
    this.logger.log(`[notification] ${event.type}`, event)
  }
}
