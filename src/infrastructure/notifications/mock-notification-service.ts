import type { DomainEvent } from '#/domain/domain-events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export interface NotificationLogger {
  log(message: string, envelope: EventEnvelope<DomainEvent>): void
}

// Demo adapter. No email, SMS, or other external delivery.
export class MockNotificationService {
  constructor(private readonly logger: NotificationLogger) {}

  notify(envelope: EventEnvelope<DomainEvent>): void {
    this.logger.log(`[notification] ${envelope.event.type}`, envelope)
  }
}
