import { expect, test } from 'bun:test'
import {
  ageInSeconds,
  startStopwatch,
} from '#/platform/observability/timing.ts'
import { given } from './support/given.ts'

test('a stopwatch preserves fractional milliseconds and reads both units from one sample', () =>
  given(() => {
    let now = 100
    return {
      stopwatch: startStopwatch(() => now),
      advance: (milliseconds: number) => {
        now += milliseconds
      },
    }
  })
    .when(({ stopwatch, advance }) => {
      const initial = stopwatch.elapsed()
      advance(1250.5)
      const elapsed = stopwatch.elapsed()
      advance(500)
      return { initial, elapsed, later: stopwatch.elapsed() }
    })
    .then(({ initial, elapsed, later }) => {
      expect(initial).toEqual({ milliseconds: 0, seconds: 0 })
      expect(elapsed).toEqual({ milliseconds: 1250.5, seconds: 1.2505 })
      expect(later).toEqual({ milliseconds: 1750.5, seconds: 1.7505 })
    }))

test.each([
  { occurredAt: 1000, now: 2250, seconds: 1.25 },
  { occurredAt: 1000, now: 1000, seconds: 0 },
  { occurredAt: 2250, now: 1000, seconds: 0 },
])(
  'event age is non-negative seconds: $occurredAt at $now',
  ({ occurredAt, now, seconds }) =>
    given(() => new Date(occurredAt))
      .when((eventTime) => ageInSeconds(eventTime, now))
      .then((age) => {
        expect(age).toBe(seconds)
      }),
)
