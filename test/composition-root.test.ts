import { expect, test } from 'bun:test'
import { anApplication } from './support/application-fixture.ts'
import { TOKEN } from '#/tokens.ts'
import { createContainer } from '#/composition-root.ts'
import type { ApplicationEvent } from '#/domain/domain-events.ts'

test('one app per container and independent apps do not share repositories or buses', async () => {
  const first = anApplication()
  const second = anApplication()
  const firstApp = first.container.resolve(TOKEN.App)
  const secondApp = second.container.resolve(TOKEN.App)
  expect(firstApp).toBe(first.container.resolve(TOKEN.App))
  expect(firstApp).not.toBe(secondApp)
  expect(first.container.resolve(TOKEN.EventBus)).not.toBe(
    second.container.resolve(TOKEN.EventBus),
  )
  await first.createEvent()
  const response = await firstApp.request('/events')
  expect(response.status).toBe(200)
  expect(await response.json()).toHaveLength(1)
  expect(await (await secondApp.request('/events')).json()).toEqual([])
  expect((await firstApp.request('/missing')).status).toBe(404)
})

test('the mock logger receives the event name and payload through the shared bus', async () => {
  const fixture = anApplication()
  const logs: { message: string; event: ApplicationEvent }[] = []
  const container = createContainer({
    repository: fixture.repository,
    clock: { now: () => new Date('2030-01-01T00:00:00Z') },
    notificationLogger: {
      log: (message, event) => {
        logs.push({ message, event })
      },
    },
  })
  await container.resolve(TOKEN.ListEventsUseCase).execute({})
  expect(logs).toEqual([
    {
      message: '[notification] EventsListed',
      event: {
        type: 'EventsListed',
        content: { count: 0 },
        context: {
          occurredAt: new Date('2030-01-01T00:00:00Z'),
          version: 'v1',
        },
      },
    },
  ])
})

test('resolving services repeatedly does not duplicate notifications and subscriptions can be stopped', async () => {
  const app = anApplication()
  app.container.resolve(TOKEN.App)
  app.container.resolve(TOKEN.App)
  app.container.resolve(TOKEN.CreateEventUseCase)
  await app.createEvent()
  expect(app.notifications).toHaveLength(1)
  const unsubscribe = app.container.resolve(TOKEN.NotificationSubscription)
  unsubscribe()
  unsubscribe()
  await app.createEvent()
  expect(app.notifications).toHaveLength(1)
})
