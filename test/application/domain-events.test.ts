import { expect, test } from 'bun:test'
import {
  anApplication,
  anExistingEvent,
} from '../support/application-fixture.ts'
import { EventId, ReservationId } from '#/domain/ids.ts'
import { TOKEN } from '#/tokens.ts'
import { Result } from '#/shared-kernel/result.ts'

test('every successful use case delivers a typed event to the mock notifications', async () => {
  const app = anApplication()
  const event = await app.createEvent()
  await app.services.update.execute({
    id: event.data.id,
    patch: { title: 'Updated' },
  })
  const reservation = Result.getOrThrow(
    await app.services.reserve.execute({
      eventId: event.data.id,
      userId: app.alice,
      quantity: 1,
    }),
  )
  await app.services.cancel.execute({
    id: reservation.data.id,
    userId: app.alice,
  })
  await app.services.read.get.execute(event.data.id)
  await app.services.read.list.execute({ category: 'gaming' })
  await app.services.read.reservationsFor.execute(app.alice)
  expect(app.notifications.map((event) => event.type)).toEqual([
    'EventCreated',
    'EventUpdated',
    'EventReserved',
    'ReservationCancelled',
    'EventViewed',
    'EventsListed',
    'ReservationsListed',
  ])
  expect(app.notifications[0]).toEqual({
    type: 'EventCreated',
    context: { occurredAt: new Date('2030-01-01T00:00:00Z'), version: 'v1' },
    content: {
      eventId: event.data.id,
      title: 'Game night',
      category: 'gaming',
      startsAt: app.eventInput.startsAt,
      capacity: 1,
      venueId: app.venueId,
    },
  })
  expect(app.notifications[1]?.content).toMatchObject({ title: 'Updated' })
  expect(app.notifications[2]?.content).toEqual({
    reservationId: reservation.data.id,
    eventId: event.data.id,
    userId: app.alice,
    quantity: 1,
  })
  expect(app.notifications[5]?.content).toEqual({
    category: 'gaming',
    count: 1,
  })
  expect(app.notifications[6]?.content).toEqual({ userId: app.alice, count: 1 })
})

test('failed use cases publish no success events', async () => {
  const app = await anExistingEvent()
  app.notifications.length = 0
  await app.services.create.execute({ ...app.eventInput, capacity: 0 })
  await app.services.update.execute({
    id: app.event.data.id,
    patch: { capacity: 0 },
  })
  await app.services.reserve.execute({
    eventId: app.event.data.id,
    userId: app.alice,
    quantity: 2,
  })
  await app.services.cancel.execute({
    id: ReservationId.make(),
    userId: app.alice,
  })
  await app.services.read.get.execute(EventId.make())
  expect(app.notifications).toEqual([])
})

test('empty queries emit successful read observations', async () => {
  const app = anApplication()
  await app.services.read.list.execute({})
  await app.services.read.reservationsFor.execute(app.alice)
  expect(app.notifications.map((event) => event.content)).toEqual([
    { count: 0 },
    { userId: app.alice, count: 0 },
  ])
})

test('publication follows persistence and awaits asynchronous subscribers', async () => {
  const app = anApplication()
  let observed = false
  app.container.resolve(TOKEN.EventBus).subscribe(async (event) => {
    if (event.type !== 'EventCreated') {
      return
    }
    await Promise.resolve()
    expect((await app.repository.findEvent(event.content.eventId))._tag).toBe(
      'Some',
    )
    observed = true
  })
  await app.createEvent()
  expect(observed).toBe(true)
})

test('retried reservation callbacks still publish only one committed event', async () => {
  const app = await anExistingEvent()
  app.notifications.length = 0
  const reserve = app.repository.reserve.bind(app.repository)
  let attempts = 0
  app.repository.reserve = (eventId, create) =>
    reserve(eventId, (event, seats) => {
      attempts++
      create(event, seats)
      attempts++
      return create(event, seats)
    })
  const result = await app.services.reserve.execute({
    eventId: app.event.data.id,
    userId: app.alice,
    quantity: 1,
  })
  expect(Result.isSuccess(result)).toBe(true)
  expect(attempts).toBe(2)
  expect(app.notifications.map((event) => event.type)).toEqual([
    'EventReserved',
  ])
})

test('repository rejections publish nothing', async () => {
  const app = anApplication()
  app.repository.createEvent = async () => {
    throw new Error('storage unavailable')
  }
  await expect(app.services.create.execute(app.eventInput)).rejects.toThrow(
    'storage unavailable',
  )
  expect(app.notifications).toEqual([])
})
