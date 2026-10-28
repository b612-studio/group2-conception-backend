# Services and dependency injection

Dependency injection, or DI, means supplying an object's dependencies from the
outside instead of having that object construct them.

[CreateEventUseCase](commands/create-event.ts) receives an `EventRepository`, a `Clock` and
an `IdGenerator` through its constructor. It does not open a database connection,
read the system clock directly or choose its own identifier implementation.

## Where we assemble the application

[services.ts](services.ts) groups the application operations and passes their
dependencies into their constructors. `createServices` is a factory, not a DI
container or a service locator. Callers receive the resulting services directly.

Write use cases live in `commands/` and implement the shared
[CommandHandler](../shared-kernel/command-handler.ts) interface. Read use cases
live in `queries/` and implement [QueryHandler](../shared-kernel/query-handler.ts).
Each use case exposes `execute` with one command or query argument. The `read`
group in `services.ts` contains query use cases, not a multi-method read service.
Both groups use the same repository; this split does not introduce separate
read and write stores.

[bootstrap.ts](../bootstrap.ts) is the composition root. It chooses a persistence
adapter from configuration, creates its client, passes the repository to
`createServices`, then supplies those services to the HTTP application. It also
owns connection cleanup on shutdown.

The default clock uses `new Date()`, and the default generator makes UUID v7 IDs.
Their implementations are selected outside the handlers. Controllers likewise
receive services instead of creating handlers or repositories themselves.

## Why inject these dependencies

Tests can supply an in-memory repository, a fixed clock and controlled IDs. They
exercise the same handler logic without a live database or dependence on the
current date. See the [application fixture](../../test/support/application-fixture.ts).

Production can select PostgreSQL, Kysely, Drizzle or Valkey without changing the
handler constructors. The [repository contract](ports.ts) specifies the operations
each adapter must provide.

A domain entity does not need to receive all of these services. The application
passes it the data it needs, such as `now` and the reserved-seat count. This keeps
database access out of entity methods.

## Injection and inversion are different ideas

Injection is how an implementation is supplied. Dependency inversion is about
which module owns the abstraction. Here the application owns `EventRepository`,
and infrastructure implements it. Supplying a concrete SQL client to every
handler would still be injection, but would not give us that same independence
from the database library.
