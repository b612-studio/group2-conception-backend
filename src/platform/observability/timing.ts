export type ElapsedTime = {
  milliseconds: number
  seconds: number
}

// Monotonic time for operations. Each reading supplies both units from the
// same sample, so logs and metrics describe the same elapsed duration.
export function startStopwatch(now: () => number = () => performance.now()) {
  const startedAt = now()
  return {
    elapsed(): ElapsedTime {
      const milliseconds = now() - startedAt
      return { milliseconds, seconds: milliseconds / 1000 }
    },
  }
}

// Event age uses wall-clock time. Future timestamps contribute zero age.
export function ageInSeconds(occurredAt: Date, now = Date.now()): number {
  return Math.max(0, (now - occurredAt.getTime()) / 1000)
}
