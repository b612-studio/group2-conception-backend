import type { RedisClient } from 'bun'
import type { UserId, VenueId } from '#/domain/ids.ts'
import { Option } from '#/shared-kernel/option.ts'
import {
  ValkeyEventRepository,
  type MutationAttempt,
  type RetryPolicy,
} from '#/infrastructure/repository/valkey-event-repository.ts'

type Task<Value> = (signal: AbortSignal) => Promise<Value>

export interface RetryOptions {
  maxAttempts: number
  delay: (attempt: number) => number
  sleep: (milliseconds: number) => Promise<void>
}

// None means contention, Some means done. Rejections are never retried:
// retrying a connection failure could repeat a write that already committed.
export function retry<Value>(
  attempt: MutationAttempt<Value>,
  options: RetryOptions,
): Task<Value> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new Error('maxAttempts must be a positive integer')
  }
  const run = async (signal: AbortSignal, index: number): Promise<Value> => {
    signal.throwIfAborted()
    const result = await attempt(signal)
    if (Option.isSome(result)) {
      return result.value
    }
    if (index + 1 >= options.maxAttempts) {
      throw new Error('Valkey repository write contention exceeded retry limit')
    }
    await options.sleep(options.delay(index))
    return run(signal, index + 1)
  }
  return (signal) => run(signal, 0)
}

// One deadline for the entire retry sequence, including reads and backoff.
// Aborting cannot undo an EVAL already sent to Valkey. Such a timeout has an
// unknown write outcome; callers must reconcile, not blindly repeat the command.
export function withTimeout<Value>(
  milliseconds: number,
  task: Task<Value>,
): () => Promise<Value> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error('timeoutMs must be positive and finite')
  }
  return async () => {
    const controller = new AbortController()
    let rejectTimeout: (reason: unknown) => void = () => {}
    const expired = new Promise<never>((_, reject) => {
      rejectTimeout = reject
    })
    const timer = setTimeout(() => {
      const error = new Error(
        `Valkey mutation timed out after ${milliseconds}ms`,
      )
      controller.abort(error)
      rejectTimeout(error)
    }, milliseconds)
    try {
      return await Promise.race([task(controller.signal), expired])
    } finally {
      clearTimeout(timer)
    }
  }
}

export function functionalRetryPolicy(
  options: Partial<RetryOptions> & { timeoutMs?: number } = {},
): RetryPolicy {
  const retryOptions: RetryOptions = {
    maxAttempts: options.maxAttempts ?? 32,
    delay: options.delay ?? ((attempt) => Math.min(2 ** attempt, 50)),
    sleep: options.sleep ?? Bun.sleep,
  }
  return <Value>(attempt: MutationAttempt<Value>) =>
    withTimeout(options.timeoutMs ?? 5000, retry(attempt, retryOptions))()
}

// Same storage/codec and contract, different execution policy.
export class FunctionalValkeyEventRepository extends ValkeyEventRepository {
  constructor(
    client: RedisClient,
    references: { users: ReadonlySet<UserId>; venues: ReadonlySet<VenueId> },
    key = 'events:repository:v1',
    options: Partial<RetryOptions> & { timeoutMs?: number } = {},
  ) {
    super(client, references, key, functionalRetryPolicy(options))
  }
}
