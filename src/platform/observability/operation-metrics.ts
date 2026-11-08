import { metrics, type Attributes } from '@opentelemetry/api'
import { ageInSeconds, startStopwatch } from './timing.ts'

type DurationMetric =
  | 'db.client.operation.duration'
  | 'events.repository.operation.duration'
  | 'events.messaging.listener.duration'

// A completed call may return a business rejection. Only thrown infrastructure
// failures are labelled failed. Monotonic elapsed time is always in seconds.
export async function measureOperation<Value>(
  name: DurationMetric,
  attributes: Attributes,
  work: () => PromiseLike<Value> | Value,
): Promise<Value> {
  const duration = metrics
    .getMeter('events-infrastructure')
    .createHistogram(name, {
      unit: 's',
      description: 'Client-observed operation duration, including waits',
      advice: {
        explicitBucketBoundaries: [
          0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
        ],
      },
    })
  const stopwatch = startStopwatch()
  let outcome: 'completed' | 'failed' = 'completed'
  try {
    return await work()
  } catch (cause) {
    outcome = 'failed'
    throw cause
  } finally {
    duration.record(stopwatch.elapsed().seconds, {
      ...attributes,
      outcome,
    })
  }
}

export async function measureOutboxAttempt(
  work: () => Promise<boolean>,
): Promise<boolean> {
  const attempts = metrics
    .getMeter('events-infrastructure')
    .createCounter('events.outbox.delivery.attempts', {
      unit: '{attempt}',
      description:
        'Delivery attempts by committed delivery, empty poll or failure; retries count again',
    })
  try {
    const delivered = await work()
    attempts.add(1, { outcome: delivered ? 'delivered' : 'empty' })
    return delivered
  } catch (cause) {
    attempts.add(1, { outcome: 'failed' })
    throw cause
  }
}

// This is age since the domain event occurred, NOT time since insertion into SQL.
// Recorded once per processing attempt, including retries that later fail.
export function recordOutboxMessageAge(occurredAt: Date) {
  metrics
    .getMeter('events-infrastructure')
    .createHistogram('events.outbox.message.age', {
      unit: 's',
      description:
        'Age since event occurrence when delivery starts, including repeated attempts',
      advice: {
        explicitBucketBoundaries: [1, 5, 10, 30, 60, 300, 900, 3600, 86400],
      },
    })
    .record(ageInSeconds(occurredAt))
}
