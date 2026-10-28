import { expect, test } from 'bun:test'
import {
  functionalRetryPolicy,
  retry,
  withTimeout,
} from '#/infrastructure/valkey-event-repository-functional.ts'
import { Option } from '#/shared-kernel/option.ts'

const signal = () => new AbortController().signal

test('functional retry returns immediately on success', async () => {
  let calls = 0
  const task = retry(
    async () => {
      calls++
      return Option.some('done')
    },
    {
      maxAttempts: 3,
      delay: () => {
        throw new Error('must not back off')
      },
      sleep: async () => {
        throw new Error('must not sleep')
      },
    },
  )
  expect(await task(signal())).toBe('done')
  expect(calls).toBe(1)
})

test('functional retry composes contention with injected backoff', async () => {
  let calls = 0
  const sleeps: number[] = []
  const task = retry(
    async () => (++calls === 3 ? Option.some('done') : Option.none()),
    {
      maxAttempts: 3,
      delay: (attempt) => 2 ** attempt,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    },
  )
  expect(await task(signal())).toBe('done')
  expect(calls).toBe(3)
  expect(sleeps).toEqual([1, 2])
})

test('retry exhaustion is bounded and does not sleep after the last attempt', () => {
  let calls = 0
  let sleeps = 0
  const task = retry(
    async () => {
      calls++
      return Option.none()
    },
    {
      maxAttempts: 3,
      delay: () => 0,
      sleep: async () => {
        sleeps++
      },
    },
  )
  expect(task(signal())).rejects.toThrow('contention exceeded retry limit')
  expect(calls).toBe(3)
  expect(sleeps).toBe(2)
})

test('infrastructure failures propagate without retry', () => {
  const error = new Error('connection lost')
  let calls = 0
  const run = functionalRetryPolicy({ sleep: async () => {} })
  expect(
    run(async () => {
      calls++
      throw error
    }),
  ).rejects.toBe(error)
  expect(calls).toBe(1)
})

test('timeout rejects a stalled operation and aborts its signal', () => {
  let received: AbortSignal | undefined
  const run = withTimeout(10, async (abortSignal) => {
    received = abortSignal
    return new Promise<never>(() => {})
  })
  expect(run()).rejects.toThrow('timed out')
  expect(received?.aborted).toBe(true)
})

test('deadline covers backoff and prevents attempts after timeout', async () => {
  let calls = 0
  let release: () => void = () => {}
  let backoff: Promise<void> | undefined
  const run = functionalRetryPolicy({
    timeoutMs: 10,
    sleep: () => {
      backoff = new Promise<void>((resolve) => {
        release = resolve
      })
      return backoff
    },
  })
  expect(
    run(async () => {
      calls++
      return Option.none()
    }),
  ).rejects.toThrow('timed out')
  release()
  await backoff
  await Bun.sleep(0)
  expect(calls).toBe(1)
})

test('already aborted tasks perform no attempt', () => {
  const controller = new AbortController()
  controller.abort(new Error('stopped'))
  let calls = 0
  const task = retry(
    async () => {
      calls++
      return Option.some('done')
    },
    {
      maxAttempts: 3,
      delay: () => 0,
      sleep: async () => {},
    },
  )
  expect(task(controller.signal)).rejects.toThrow('stopped')
  expect(calls).toBe(0)
})

test('invalid retry and timeout configuration fails before execution', () => {
  expect(() =>
    retry(async () => Option.none(), {
      maxAttempts: 0,
      delay: () => 0,
      sleep: async () => {},
    }),
  ).toThrow('positive integer')
  expect(() => withTimeout(0, async () => 'done')).toThrow(
    'positive and finite',
  )
})
