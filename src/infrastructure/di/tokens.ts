import type { Hono } from 'hono'
import type {
  Clock,
  EventRepository,
  IdGenerator,
} from '#/application/ports.ts'
import type { DemoIdentity } from '#/application/demo-identity.ts'
import type { CreateEventUseCase } from '#/application/commands/create-event.ts'
import type { UpdateEventUseCase } from '#/application/commands/update-event.ts'
import type { ReserveEventUseCase } from '#/application/commands/reserve-event.ts'
import type { CancelReservationUseCase } from '#/application/commands/cancel-reservation.ts'
import type { ListEventsUseCase } from '#/application/queries/list-events.ts'
import type { GetEventUseCase } from '#/application/queries/get-event.ts'
import type { ListReservationsUseCase } from '#/application/queries/list-reservations.ts'
import type { EventCommandController } from '#/controllers/commands/event-controller.ts'
import type { EventQueryController } from '#/controllers/queries/event-controller.ts'
import type { UserQueryController } from '#/controllers/queries/user-controller.ts'
import type { DomainEvent } from '#/domain/domain-events.ts'
import type { EventEnvelope } from '#/shared-kernel/event-envelope.ts'
import type { MockNotificationService } from '#/infrastructure/notifications/mock-notification-service.ts'
import type { EventBus, Unsubscribe } from '#/shared-kernel/event-bus.ts'
import { createToken } from '#/infrastructure/di/token.ts'

export const TOKEN = {
  EventRepository: createToken<EventRepository>('EventRepository'),
  Clock: createToken<Clock>('Clock'),
  IdGenerator: createToken<IdGenerator>('IdGenerator'),
  EventBus: createToken<EventBus<EventEnvelope<DomainEvent>>>('EventBus'),
  NotificationService: createToken<MockNotificationService>(
    'NotificationService',
  ),
  NotificationSubscription: createToken<Unsubscribe>(
    'NotificationSubscription',
  ),
  Identity: createToken<DemoIdentity>('Identity'),
  CreateEventUseCase: createToken<CreateEventUseCase>('CreateEventUseCase'),
  UpdateEventUseCase: createToken<UpdateEventUseCase>('UpdateEventUseCase'),
  ReserveEventUseCase: createToken<ReserveEventUseCase>('ReserveEventUseCase'),
  CancelReservationUseCase: createToken<CancelReservationUseCase>(
    'CancelReservationUseCase',
  ),
  ListEventsUseCase: createToken<ListEventsUseCase>('ListEventsUseCase'),
  GetEventUseCase: createToken<GetEventUseCase>('GetEventUseCase'),
  ListReservationsUseCase: createToken<ListReservationsUseCase>(
    'ListReservationsUseCase',
  ),
  EventCommandController: createToken<EventCommandController>(
    'EventCommandController',
  ),
  EventQueryController: createToken<EventQueryController>(
    'EventQueryController',
  ),
  UserQueryController: createToken<UserQueryController>('UserQueryController'),
  App: createToken<Hono>('App'),
} as const
