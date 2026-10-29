export interface DomainEvent {
  context: unknown
  content: unknown
}

export type MessageListener = (e: DomainEvent) => Promise<void> | void
export type Unsubscribe = () => void

export interface EventBus {
  subscribe(listener: MessageListener): Unsubscribe
  publish(e: DomainEvent): Promise<void>
}

export class InMemoryEventBus implements EventBus {
  private listeners: Map<symbol, MessageListener>
  constructor() {
    this.listeners = new Map()
  }

  subscribe(listener: MessageListener): Unsubscribe {
    const token = Symbol('key')
    this.listeners.set(token, listener)
    return () => this.listeners.delete(token)
  }
  async publish(event: DomainEvent): Promise<void> {
    const promises = [...this.listeners.values()].map((listener) =>
      listener(event),
    )
    await Promise.allSettled(promises)
  }
}

class DemoEvent implements DomainEvent {
  constructor(
    public context: object,
    public content: string,
  ) {}
}

function demo() {
  const eventBus: EventBus = new InMemoryEventBus()

  const unsubscribe = eventBus.subscribe((event: DomainEvent) => {
    console.log(event)
  })

  eventBus.subscribe((event: DomainEvent) => {
    console.log(event.content + ' listner 2')
  })

  const event = new DemoEvent({}, 'sujet 1')

  eventBus.publish(event)

  unsubscribe()
  eventBus.publish(event)
}

demo()
