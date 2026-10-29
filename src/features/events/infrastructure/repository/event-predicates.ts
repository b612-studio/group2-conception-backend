import type { EventFilter } from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'

// Match the application filter for adapters that filter decoded events in memory.
export function matchesEventFilter(
  filter: EventFilter,
): (event: Event) => boolean {
  return ({ data }) => {
    if (filter.category !== undefined && data.category !== filter.category) {
      return false
    }
    if (filter.after !== undefined && !(data.startsAt > filter.after)) {
      return false
    }
    return true
  }
}
