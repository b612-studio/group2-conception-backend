import type {
  EventBus,
  MessageListener,
  Unsubscribe,
} from '#/shared-kernel/event-bus.ts'

export class InMemoryEventBus<Message> implements EventBus<Message> {
  private readonly listeners = new Map<symbol, MessageListener<Message>>()

  subscribe(listener: MessageListener<Message>): Unsubscribe {
    const token = Symbol('event-listener')
    this.listeners.set(token, listener)
    return () => {
      this.listeners.delete(token)
    }
  }

  // Snapshot subscriptions, await every listener, and isolate both thrown and rejected failures.
  async publish(message: Message): Promise<void> {
    const results = await Promise.allSettled(
      [...this.listeners.values()].map(async (listener) => listener(message)),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Event listener failed', result.reason)
      }
    }
  }
}
