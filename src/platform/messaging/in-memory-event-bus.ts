import { SpanKind } from '@opentelemetry/api'
import { measureOperation } from '#/platform/observability/operation-metrics.ts'
import { inSpan } from '#/platform/observability/spans.ts'
import type {
  EventBus,
  MessageListener,
  Unsubscribe,
} from '#/shared-kernel/event-bus.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'

export class InMemoryEventBus<
  Event extends { _tag: string },
> implements EventBus<Event> {
  private readonly listenersByTag = new Map<
    Event['_tag'],
    Set<MessageListener<Event>>
  >()

  constructor(private readonly propagateFailures = false) {}

  subscribe<Tag extends Event['_tag']>(
    tag: Tag,
    listener: MessageListener<Extract<Event, { _tag: Tag }>>,
  ): Unsubscribe {
    const matches = (
      message: EventEnvelope<Event>,
    ): message is EventEnvelope<Extract<Event, { _tag: Tag }>> =>
      message.event._tag === tag
    const receive: MessageListener<Event> = (message) => {
      if (matches(message)) {
        return listener(message)
      }
    }

    let listeners = this.listenersByTag.get(tag)
    if (!listeners) {
      listeners = new Set()
      this.listenersByTag.set(tag, listeners)
    }
    const bucket = listeners
    bucket.add(receive)
    return () => {
      bucket.delete(receive)
      if (bucket.size === 0 && this.listenersByTag.get(tag) === bucket) {
        this.listenersByTag.delete(tag)
      }
    }
  }

  async publish(message: EventEnvelope<Event>): Promise<void> {
    return inSpan('event.publish', async (span) => {
      span.setAttribute('event.type', message.event._tag)
      const listeners = this.listenersByTag.get(message.event._tag)
      if (!listeners) {
        return
      }
      const results = await Promise.allSettled(
        [...listeners].map((listener) =>
          inSpan(
            'event.listener',
            () =>
              measureOperation(
                'events.messaging.listener.duration',
                { 'event.type': message.event._tag },
                () => listener(message),
              ),
            {
              kind: SpanKind.CONSUMER,
              attributes: { 'event.type': message.event._tag },
            },
          ),
        ),
      )
      const failures: unknown[] = []
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('Event listener failed', result.reason)
          failures.push(result.reason)
        }
      }
      if (this.propagateFailures && failures.length > 0) {
        throw new AggregateError(failures, 'Event delivery failed')
      }
    })
  }
}
