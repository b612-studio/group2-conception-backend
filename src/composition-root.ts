import { Container } from '#/infrastructure/di/container.ts'
import { TOKEN } from '#/infrastructure/di/tokens.ts'
import { createApp } from '#/app.ts'
import { CreateEventUseCase } from '#/application/commands/create-event.ts'
import { UpdateEventUseCase } from '#/application/commands/update-event.ts'
import { ReserveEventUseCase } from '#/application/commands/reserve-event.ts'
import { CancelReservationUseCase } from '#/application/commands/cancel-reservation.ts'
import { ListEventsUseCase } from '#/application/queries/list-events.ts'
import { GetEventUseCase } from '#/application/queries/get-event.ts'
import { ListReservationsUseCase } from '#/application/queries/list-reservations.ts'
import { DemoIdentity } from '#/application/demo-identity.ts'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'
import { createEventCommandController } from '#/controllers/commands/event-controller.ts'
import { createEventQueryController } from '#/controllers/queries/event-controller.ts'
import { createUserQueryController } from '#/controllers/queries/user-controller.ts'
import { makeId } from '#/domain/ids.ts'
import type { DomainEvent } from '#/domain/domain-events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import {
  MockNotificationService,
  type NotificationLogger,
} from '#/infrastructure/notifications/mock-notification-service.ts'
import type { EventBus } from '#/shared-kernel/event-bus.ts'
import { InMemoryEventBus } from '#/infrastructure/messaging/in-memory-event-bus.ts'

export interface ContainerOptions {
  repository: EventRepository
  clock?: Clock
  ids?: IdGenerator
  eventBus?: EventBus<EventEnvelope<DomainEvent>>
  notificationLogger?: NotificationLogger
}

// Only the composition root resolves tokens. Application code receives ordinary dependencies.
export function createContainer(options: ContainerOptions): Container {
  const container = new Container()
  container
    .singleton(TOKEN.EventRepository, () => options.repository)
    .singleton(TOKEN.Clock, () => options.clock ?? { now: () => new Date() })
    .singleton(TOKEN.IdGenerator, () => options.ids ?? { next: makeId })
    .singleton(
      TOKEN.EventBus,
      () =>
        options.eventBus ?? new InMemoryEventBus<EventEnvelope<DomainEvent>>(),
    )
    .singleton(
      TOKEN.NotificationService,
      () => new MockNotificationService(options.notificationLogger ?? console),
    )
    .singleton(TOKEN.NotificationSubscription, (c) => {
      const notifications = c.resolve(TOKEN.NotificationService)
      return c
        .resolve(TOKEN.EventBus)
        .subscribe((event) => notifications.notify(event))
    })
    .singleton(
      TOKEN.Identity,
      (c) => new DemoIdentity(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(
      TOKEN.CreateEventUseCase,
      (c) =>
        new CreateEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.UpdateEventUseCase,
      (c) =>
        new UpdateEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.ReserveEventUseCase,
      (c) =>
        new ReserveEventUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.CancelReservationUseCase,
      (c) =>
        new CancelReservationUseCase(
          c.resolve(TOKEN.EventRepository),
          c.resolve(TOKEN.Clock),
          c.resolve(TOKEN.IdGenerator),
          c.resolve(TOKEN.EventBus),
        ),
    )
    .singleton(
      TOKEN.ListEventsUseCase,
      (c) => new ListEventsUseCase(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(
      TOKEN.GetEventUseCase,
      (c) => new GetEventUseCase(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(
      TOKEN.ListReservationsUseCase,
      (c) => new ListReservationsUseCase(c.resolve(TOKEN.EventRepository)),
    )
    .singleton(TOKEN.EventCommandController, (c) =>
      createEventCommandController({
        identity: c.resolve(TOKEN.Identity),
        create: c.resolve(TOKEN.CreateEventUseCase),
        update: c.resolve(TOKEN.UpdateEventUseCase),
        reserve: c.resolve(TOKEN.ReserveEventUseCase),
        cancel: c.resolve(TOKEN.CancelReservationUseCase),
      }),
    )
    .singleton(TOKEN.EventQueryController, (c) =>
      createEventQueryController({
        list: c.resolve(TOKEN.ListEventsUseCase),
        get: c.resolve(TOKEN.GetEventUseCase),
      }),
    )
    .singleton(TOKEN.UserQueryController, (c) =>
      createUserQueryController({
        identity: c.resolve(TOKEN.Identity),
        reservationsFor: c.resolve(TOKEN.ListReservationsUseCase),
      }),
    )
    .singleton(TOKEN.App, (c) =>
      createApp(
        c.resolve(TOKEN.EventCommandController),
        c.resolve(TOKEN.EventQueryController),
        c.resolve(TOKEN.UserQueryController),
      ),
    )

  // Subscribe once even when callers resolve a use case without resolving the HTTP app.
  container.resolve(TOKEN.NotificationSubscription)
  return container
}
