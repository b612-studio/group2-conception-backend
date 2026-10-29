# Container and dependency injection

Dependency injection means supplying dependencies from outside an object instead
of having that object construct them. Use cases receive a repository, clock,
ID generator where needed, and an event bus through their constructors. They do
not resolve tokens, open database connections or depend on Hono.

## Composition root

[container.ts](../container.ts) implements typed singleton and factory
registrations. It has no application registrations or infrastructure imports.
[Token creation](../shared-kernel/token.ts) is separate from the
[application token registry](../tokens.ts).

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
booking, event and owner IDs plus quantity. `context` contains the injected-clock
occurrence time and schema version `v1`.

To observe every use case, successful queries also publish `EventViewed`,
`EventsListed` and `ReservationsListed`. These are application read observations,
not domain mutations. List observations include a count, not the result arrays.
Missing-event reads and failed commands emit no success event. The demo identity
helper is not a use case and does not publish events.

Use cases await publication after the repository returns success. They never
publish inside repository callbacks, which can be retried. The shared
[InMemoryEventBus](../shared-kernel/event-bus.ts) snapshots listeners, runs them
concurrently and awaits all of them. It logs both synchronous and asynchronous
listener failures without rejecting a committed command.

The [mock notification service](../infrastructure/mock-notification-service.ts)
subscribes once during container creation and logs every event. It sends no real
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
