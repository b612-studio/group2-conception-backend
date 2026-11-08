import { inSpan } from '#/platform/observability/spans.ts'
import type {
  EventReadRepository,
  EventProjectionRepository,
} from '#/features/events/application/ports.ts'
import type { DomainEvent } from '#/features/events/contracts/events.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'

// Reload committed state rather than replaying potentially stale event payloads.
// Queue refreshes so concurrent publications cannot overwrite a newer snapshot
// with an earlier read in this process. A failed refresh must not poison the queue.
export function createEventsReadModelSubscriber(
  source: EventReadRepository,
  projection: EventProjectionRepository,
) {
  let pending = Promise.resolve()
  const refresh = () => {
    const previous = pending
    const next = inSpan('events.readModel.refresh', async () => {
      // Include queue wait in refresh duration, but not in the query spans.
      await previous
      const events = await source.listEvents({})
      await projection.replaceEvents(events)
    })
    pending = next.catch(() => {})
    return next
  }

  return {
    refresh,
    subscribe(bus: EventBus<DomainEvent>) {
      const stops = [
        bus.subscribe('EventCreated', refresh),
        bus.subscribe('EventUpdated', refresh),
      ]
      return () => {
        for (const stop of stops) {
          stop()
        }
      }
    },
  }
}
