import { createServices } from '#/application/services.ts'
import type { EventInput } from '#/domain/event.ts'
import { UserId, VenueId } from '#/domain/ids.ts'
import { InMemoryEventRepository } from '#/infrastructure/repository/in-memory-event-repository.ts'
import { Result } from '#/shared-kernel/result.ts'

// Each scenario owns its repository and clock. No HTTP app or external storage.
export function anApplication() {
  const alice = UserId.make()
  const bob = UserId.make()
  const venueId = VenueId.make()
  let now = new Date('2030-01-01T00:00:00Z')
  const repository = new InMemoryEventRepository({
    users: new Set([alice, bob]),
    venues: new Set([venueId]),
  })
  const services = createServices(repository, { now: () => new Date(now) })
  const eventInput: EventInput = {
    title: 'Game night',
    category: 'gaming',
    startsAt: new Date('2030-01-02T18:00:00Z'),
    capacity: 1,
    venueId,
  }

  return {
    alice,
    bob,
    venueId,
    repository,
    services,
    eventInput,
    advanceTo(date: Date) {
      now = new Date(date)
    },
    async createEvent(patch: Partial<EventInput> = {}) {
      return Result.getOrThrow(
        await services.create.execute({ ...eventInput, ...patch }),
      )
    },
  }
}

export async function anExistingEvent(patch: Partial<EventInput> = {}) {
  const application = anApplication()
  const event = await application.createEvent(patch)
  return { ...application, event }
}

export async function anEventWithReservation() {
  const application = await anExistingEvent({ capacity: 2 })
  const { event } = application
  const reservation = Result.getOrThrow(
    await application.services.reserve.execute({
      eventId: event.data.id,
      userId: application.alice,
      quantity: 2,
    }),
  )
  return { ...application, event, reservation }
}
