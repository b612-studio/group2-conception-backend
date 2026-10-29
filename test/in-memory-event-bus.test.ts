import { describe, expect, spyOn, test } from 'bun:test'

import { InMemoryEventBus, type EventBus } from '#/shared-kernel/event-bus.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('InMemoryEventBus', () => {
  test('publishes without listeners and does not replay past events', async () => {
    const bus: EventBus<number> = new InMemoryEventBus<number>()
    await bus.publish(1)
    const received: number[] = []
    bus.subscribe((event) => {
      received.push(event)
    })
    await bus.publish(2)
    expect(received).toEqual([2])
  })

  test('sends the event to every listener', async () => {
    const bus = new InMemoryEventBus<{ type: string }>()
    const event = { type: 'reservation-created' }
    const received: unknown[] = []
    bus.subscribe((value) => {
      received.push(value)
    })
    bus.subscribe(async (value) => {
      received.push(value)
    })
    await bus.publish(event)
    expect(received).toEqual([event, event])
    expect(received[0]).toBe(event)
    expect(received[1]).toBe(event)
  })

  test('runs listeners concurrently and waits for all of them', async () => {
    const bus = new InMemoryEventBus<number>()
    const release = deferred()
    const fastFinished = deferred()
    let slowFinished = false
    let published = false
    bus.subscribe(async () => {
      await release.promise
      slowFinished = true
    })
    bus.subscribe(() => {
      fastFinished.resolve()
    })

    const publishing = bus.publish(1).then(() => {
      published = true
    })
    try {
      await fastFinished.promise
      expect(slowFinished).toBe(false)
      expect(published).toBe(false)
    } finally {
      release.resolve()
      await publishing
    }
    expect(slowFinished).toBe(true)
    expect(published).toBe(true)
  })

  test('logs synchronous and asynchronous failures without skipping other listeners', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const bus = new InMemoryEventBus<number>()
      const syncError = new Error('synchronous failure')
      const asyncError = new Error('asynchronous failure')
      const received: number[] = []
      bus.subscribe(() => {
        throw syncError
      })
      bus.subscribe(() => Promise.reject(asyncError))
      bus.subscribe((event) => {
        received.push(event)
      })

      await bus.publish(1)

      expect(received).toEqual([1])
      expect(log).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledWith('Event listener failed', syncError)
      expect(log).toHaveBeenCalledWith('Event listener failed', asyncError)
    } finally {
      log.mockRestore()
    }
  })

  test('unsubscribe is idempotent and leaves other listeners registered', async () => {
    const bus = new InMemoryEventBus<number>()
    const first: number[] = []
    const second: number[] = []
    const unsubscribe = bus.subscribe((event) => {
      first.push(event)
    })
    bus.subscribe((event) => {
      second.push(event)
    })
    await bus.publish(1)
    unsubscribe()
    unsubscribe()
    await bus.publish(2)
    expect(first).toEqual([1])
    expect(second).toEqual([1, 2])
  })

  test('registering the same listener twice creates independent subscriptions', async () => {
    const bus = new InMemoryEventBus<number>()
    const received: number[] = []
    const listener = (event: number) => {
      received.push(event)
    }
    const unsubscribe = bus.subscribe(listener)
    bus.subscribe(listener)
    await bus.publish(1)
    unsubscribe()
    await bus.publish(2)
    expect(received).toEqual([1, 1, 2])
  })

  test('subscription changes during publish only affect future publishes', async () => {
    const bus = new InMemoryEventBus<number>()
    const received: string[] = []
    let unsubscribe = () => {}
    bus.subscribe((event) => {
      if (event === 1) {
        unsubscribe()
        bus.subscribe((value) => {
          received.push(`new:${value}`)
        })
      }
    })
    unsubscribe = bus.subscribe((event) => {
      received.push(`original:${event}`)
    })
    await bus.publish(1)
    await bus.publish(2)
    expect(received).toEqual(['original:1', 'new:2'])
  })
})
