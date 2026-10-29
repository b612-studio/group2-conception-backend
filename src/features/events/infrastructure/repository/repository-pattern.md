# Repository pattern

A repository lets application code load and save domain objects without knowing
how storage works. The application depends on a contract, not a SQL client.

In this lesson, [EventRepository](../../application/ports.ts) is that contract.
Its implementations live in this directory. They use raw PostgreSQL, Kysely,
Drizzle, Valkey or memory, but handlers call the same methods.

## Why the interface belongs to the application

The application defines the operations it needs, such as reserving seats or
updating an event. Infrastructure implements those operations. A handler should
not import a PostgreSQL adapter or construct queries.

This is dependency inversion. Source-code dependencies point toward the
application contract even though execution eventually reaches a database.
[Dependency injection](../../application/dependency-injection.md) explains how
we supply a concrete adapter at startup.

## More than CRUD

A naive reservation flow reads an event, checks available seats, then saves a
reservation. Two requests can both read the last seat before either writes.
Both would pass the check.

Here, `reserve` and `updateEvent` accept a callback. The repository supplies the
event and the active reserved-seat count inside a protected mutation. PostgreSQL
adapters lock the event row in a transaction. Valkey adapters use optimistic
compare-and-set and may rerun the callback.

The callback applies domain rules. The repository protects the read-check-write
sequence. A `Failure` means no write. Callbacks must not send email, call another
API or perform any other external effect because retries could repeat it.

## What crosses the contract

- Reads return domain objects, not database rows or HTTP DTOs.
- A missing event is an `Option`, rather than a fabricated event or an exception.
- Expected mutation failures are `Result` values.
- Unexpected infrastructure faults reject the promise.

[Database mappings](../entities.md) convert stored records to domain objects.
The shared [repository contract tests](../../../../../test/event-repository.test.ts)
exercise the adapters against the same behaviors, including concurrent writes.
A shared interface alone cannot prove that adapters behave alike.

This repository groups events and reservations because their writes share the
same consistency requirement. It is not a generic `Repository<T>` with every
possible database operation.
