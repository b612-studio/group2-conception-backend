# Container and dependency injection

Dependency injection means supplying dependencies from outside an object instead
of having that object construct them. Use cases receive a repository, clock,
ID generator and an event bus for commands through their constructors. Queries
receive only a repository. Neither resolves tokens, opens database connections
or depends on Hono.

## Composition root

[container.ts](../infrastructure/di/container.ts) implements typed singleton and
factory registrations. It has no application registrations.
[Token creation](../infrastructure/di/token.ts) is separate from the
[application token registry](../infrastructure/di/tokens.ts). All DI machinery
lives in infrastructure; the composition root stays at the root of `src/`.

[composition-root.ts](../composition-root.ts) registers the repository, clock,
ID generator, event bus, notification subscriber, identity helper, seven use
cases, controllers and HTTP application. Registrations are singletons within
one container. Separate containers have independent apps and event buses.
Controllers receive explicit dependencies, not a container or a Services bag.

[bootstrap.ts](../bootstrap.ts) selects a persistence adapter through
[infrastructure/persistence.ts](../infrastructure/persistence.ts), creates the
container and resolves `TOKEN.App`. It starts the server and owns shutdown,
unsubscribing notifications before closing persistence. PostgreSQL, Kysely,
Drizzle and both Valkey implementations use the same application registrations.

Only [app.ts](../app.ts) calls `new Hono()`. Route modules register handlers on
that instance rather than allocating child applications.

Tests call the same `createContainer` with an in-memory repository, fixed clock
and capturing notification logger. The [application fixture](../../test/support/application-fixture.ts)
keeps its convenience use-case grouping locally; there is no production
`application/services.ts` factory.

## Events and mock notifications

The [event definitions](../domain/domain-events.ts) describe four command facts:
`EventCreated`, `EventUpdated`, `EventReserved` and `ReservationCancelled`.
Create and update include the persisted event details. Reservation events include
booking, event and owner IDs plus quantity. Domain facts contain only a `type`
and `content`, with no delivery metadata or factory method.

The shared [EventEnvelope](../shared-kernel/event-envelope.ts) wraps each fact
with `messageId`, `occurredAt`, `version` and `event`. The message ID identifies
this occurrence, independently of the business entity's ID. Commands generate
it through the injected ID generator; time comes from the injected clock.
The current envelope version is `1`.

Reads never publish events, including successful lookups and empty lists.
Failed commands and the demo identity helper also publish nothing.

Commands await publication after the repository returns success. They never
publish inside repository callbacks, which can be retried. The
[EventBus contract](../shared-kernel/event-bus.ts) stays in the shared kernel;
[InMemoryEventBus](../infrastructure/messaging/in-memory-event-bus.ts) lives in
infrastructure. It snapshots listeners, runs them
concurrently and awaits all of them. It logs both synchronous and asynchronous
listener failures without rejecting a committed command.

The [mock notification service](../infrastructure/notifications/mock-notification-service.ts)
subscribes once during container creation and logs every envelope with its event type. It sends no real
notifications. `TOKEN.NotificationSubscription` resolves to its unsubscribe
function. Production and tests use the same event-bus implementation.

This bus is process-local and has no durable delivery or replay. A crash between
persistence and publication can lose notifications. Use an outbox if delivery
must survive process failure.

## Injection and inversion

Injection is how an implementation is supplied. Dependency inversion is about
which module owns the abstraction. The application owns `EventRepository`, and
infrastructure implements it. Domain entities receive data such as `now` and
reserved-seat counts, not a container or repository.
