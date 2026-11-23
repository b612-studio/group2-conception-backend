import type {
  EventReadRepository,
  EventProjectionRepository,
} from '#/features/events/application/ports.ts'
import type {
  DomainEvent,
  EventCreated,
  EventUpdated,
} from '#/features/events/contracts/events.ts'
import { EventId } from '#/features/events/domain/ids.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import { Option } from '#/shared-kernel/option.ts'

export function createEventsReadModelSubscriber(
  source: EventReadRepository,
  projection: EventProjectionRepository,
) {
  let pending = Promise.resolve()

  // Serialize reads and writes. Reject the current delivery without blocking the next one.
  function enqueue(work: () => Promise<void>): Promise<void> {
    const next = pending.then(work)
    pending = next.catch(() => {})
    return next
  }

  async function rebuild(): Promise<void> {
    const events = await source.listEvents({})
    await projection.replaceEvents(events)
  }

  function projectChange({
    event,
  }: EventEnvelope<EventCreated | EventUpdated>): Promise<void> {
    return enqueue(async () => {
      if (!projection.upsertEvent) {
        return rebuild()
      }

      // The message identifies the event; the write store supplies its current state.
      const id = EventId.makeUnsafe(event.content.eventId)
      const committed = await source.findEvent(id)
      if (Option.isSome(committed)) {
        await projection.upsertEvent(committed.value)
      }
    })
  }

  return {
    refresh: () => enqueue(rebuild),
    subscribe(bus: EventBus<DomainEvent>) {
      const stops = [
        bus.subscribe('EventCreated', projectChange),
        bus.subscribe('EventUpdated', projectChange),
      ]
      return () => {
        for (const stop of stops) {
          stop()
        }
      }
    },
  }
}
