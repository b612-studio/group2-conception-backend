export interface DomainEvent {
  readonly type: string
  readonly context: { readonly occurredAt: Date; readonly version: 'v1' }
  readonly content: unknown
}

export type MessageListener<Event = DomainEvent> = (
  event: Event,
) => Promise<void> | void
export type Unsubscribe = () => void

export interface EventBus<Event = DomainEvent> {
  subscribe(listener: MessageListener<Event>): Unsubscribe
  publish(event: Event): Promise<void>
}

export class InMemoryEventBus<Event = DomainEvent> implements EventBus<Event> {
  private readonly listeners = new Map<symbol, MessageListener<Event>>()

  subscribe(listener: MessageListener<Event>): Unsubscribe {
    const token = Symbol('event-listener')
    this.listeners.set(token, listener)
    return () => {
      this.listeners.delete(token)
    }
  }

  // Snapshot subscriptions, await every listener, and isolate both thrown and rejected failures.
  async publish(event: Event): Promise<void> {
    const results = await Promise.allSettled(
      [...this.listeners.values()].map(async (listener) => listener(event)),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Event listener failed', result.reason)
      }
    }
  }
}
