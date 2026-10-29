# Day 2: Events REST API

A Hono API for events and reservations. This lesson separates HTTP handling,
application operations, domain rules and persistence. PostgreSQL is the default
storage backend, with alternative adapters for comparing persistence approaches.

## Run locally

Requires Bun and Docker Compose. From this directory:

```sh
cp .env.example .env
bun install
docker compose up -d --wait
bun run dev
```

The API listens on http://127.0.0.1:3000. PostgreSQL is available on
localhost:55432, and Adminer on http://localhost:8080.

## Environment variables

Bun loads the API configuration from `.env`. Docker Compose uses the same file
for the published service ports. `.env.example` contains the local demo settings.

| Variable           | Default                                           | Purpose                                                                            |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `PORT`             | `3000`                                            | HTTP port for the API, bound to `127.0.0.1`.                                       |
| `EVENT_REPOSITORY` | `postgres`                                        | Storage adapter: `postgres`, `kysely`, `drizzle`, `valkey` or `valkey-functional`. |
| `DATABASE_URL`     | `postgres://events:events@localhost:55432/events` | PostgreSQL connection URL for the raw SQL, Kysely and Drizzle adapters.            |
| `POSTGRES_PORT`    | `55432`                                           | Host port Docker Compose publishes for PostgreSQL.                                 |
| `VALKEY_URL`       | `redis://localhost:56379`                         | Connection URL for either Valkey adapter.                                          |
| `VALKEY_PORT`      | `56379`                                           | Host port Docker Compose publishes for Valkey.                                     |
| `ADMINER_PORT`     | `8080`                                            | Host port for the Adminer database interface.                                      |

If you change `POSTGRES_PORT`, update the port in `DATABASE_URL` too. The same
applies to `VALKEY_PORT` and `VALKEY_URL`. Restart the API after changing its
configuration, and rerun `docker compose up -d --wait` after changing service ports.
No model API key is needed.

## REST endpoints

| Endpoint                                          | Input                                                  | Concept                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `GET /events`                                     | Optional `category` and `after` query parameters       | Filter and list events. `after` is an exclusive start-date filter, not a pagination cursor. |
| `POST /events`                                    | `title`, `category`, `startsAt`, `capacity`, `venueId` | Create an event at an existing venue.                                                       |
| `GET /events/{eventId}`                           | Event ID in the path                                   | Read one event.                                                                             |
| `PATCH /events/{eventId}`                         | Non-empty partial event body                           | Update an event without reducing capacity below its active reservations.                    |
| `POST /events/{eventId}/reservations`             | `quantity`                                             | Reserve seats while checking remaining capacity.                                            |
| `GET /me/reservations`                            | `X-User-Id` header                                     | List the current demo user's reservations.                                                  |
| `POST /reservations/{reservationId}/cancellation` | Reservation ID and `X-User-Id` header                  | Cancel a reservation owned by the current demo user.                                        |

Event creation and seat reservation return `201`. Other successful operations
return `200`. Event creation also returns a `Location` header. Lists return arrays,
sorted by date and ID, without pagination.

Requests reject unknown fields, and timestamps must include a timezone. Events
must start in the future. Capacity and reservation quantity must be positive
32-bit integers. A user can make multiple reservations for the same event.
Cancellation records a timestamp instead of deleting the reservation. It is
allowed after the event starts, but cannot be repeated.

Reservation operations require `X-User-Id`, using one of the seeded user IDs below.
This header is a demo identity mechanism, not authentication. Anyone can
impersonate a seeded user. Event creation and editing are public for this lesson.
Add authentication, organizer permissions and rate limits before deploying it.
Writes are not idempotent, so do not automatically retry a timed-out reservation.

## Architecture

```text
REST routes -> Controllers -> Application operations -> Repository
                                       |
                                  Domain rules
```

- Routes define endpoints and validate incoming requests.
- Controllers translate HTTP requests into application calls and format responses.
- Application operations coordinate event creation, updates, reservations and cancellation.
- The domain defines event and reservation rules, including capacity and ownership.
- The repository interface lets application operations use storage without depending
  on a specific database library.
- Infrastructure adapters implement persistence and map stored records to domain data.
- Presenters define the public response DTOs, separate from database records.

```text
src/
  bootstrap.ts          Composition root and local HTTP server
  app.ts                Hono application setup
  routes/               REST routes and request validation
  controllers/          HTTP translation and application calls
  application/          Handlers, reads, identity and repository interface
  domain/               Event and reservation rules; UUID-v7 identifiers
  shared-kernel/        Shared types without framework dependencies
  infrastructure/       Query schemas, entity mappings and database helper
    repository/         Persistence adapters
  presentation/         DTO schemas and domain-to-DTO presenters
  validation.ts         Request schemas and branded ID conversion
sql/init.sql            PostgreSQL schema and seed data
```

The domain and application layers do not depend on Hono or Valibot. The HTTP layer
uses Valibot to validate requests and responses. Imports use the `#/*` alias defined
in `package.json` and `tsconfig.json`.

### Design guides beside the code

These guides explain the patterns through this lesson's implementation:

- [Domain](src/domain/domain.md): business rules and application coordination.
- [Domain entities](src/domain/entities.md): identity across updates and cancellation.
- [Value objects](src/domain/value-objects.md): capacity validation and value equality.
- [Branded types](src/domain/branded-types.md): distinct identifier types and runtime validation.
- [Repository pattern](src/infrastructure/repository/repository-pattern.md): storage contracts and protected mutations.
- [Database entities](src/infrastructure/entities.md): rows versus domain entities and their mappings.
- [Errors as values](src/shared-kernel/errors-as-values.md): expected failures, absence and exceptions.
- [Shared kernel](src/shared-kernel/shared-kernel.md): common types and dependency boundaries.
- [DTOs and presenters](src/presentation/dto-and-presenter.md): public JSON versus internal representations.
- [Controllers](src/controllers/controller.md): HTTP translation without business or persistence rules.
- [Services and dependency injection](src/application/dependency-injection.md): constructor dependencies and startup wiring.
- [BDD and fluent test APIs](test/bdd.md): behavior-focused scenarios, given/when/then and method chaining.
- [Functions as values and execution policies](src/infrastructure/repository/functional-composition.md): higher-order functions, predicates and retry composition.
- [AbortController and deadlines](src/infrastructure/repository/abort-controller.md): cooperative cancellation, timeout cleanup and uncertain write outcomes.

### Persistence adapters

Select an adapter through `EVENT_REPOSITORY`:

| Value               | Approach                                                       |
| ------------------- | -------------------------------------------------------------- |
| `postgres`          | Raw SQL through Bun's SQL client. Default adapter.             |
| `kysely`            | Typed SQL query builder using the `pg` driver.                 |
| `drizzle`           | ORM with TypeScript table declarations, using the `pg` driver. |
| `valkey`            | JSON snapshot storage with atomic compare-and-set writes.      |
| `valkey-functional` | Valkey variant that composes retry and timeout functions.      |

For example:

```sh
EVENT_REPOSITORY=kysely bun run dev
EVENT_REPOSITORY=drizzle bun run dev
```

The three PostgreSQL adapters share the same tables and records. Switching between
them does not copy or reset data. They lock the event row inside a transaction
before checking reserved seats and writing a reservation or capacity change. This
prevents concurrent requests from overbooking an event.

`sql/init.sql` owns the database schema. Kysely and Drizzle schemas describe those
tables for queries. Editing the TypeScript descriptions does not change the database.
There is no code generation or migration runner.

Valkey stores independent data in the `valkey_data` Docker volume with append-only
persistence. It recognizes the same demo user and venue IDs, but starts without
events. Create an event through the API before reserving seats. Switching between
PostgreSQL and Valkey does not migrate records.

The Valkey adapters read a single snapshot and retry conflicting writes through
an atomic Lua compare-and-set operation. This is a small-demo design, not a storage
approach for large datasets. The functional variant limits a mutation to 32 attempts
and a five-second deadline. A timeout cannot undo a command already sent to Valkey.

An in-memory repository is also available for tests, but is not a selectable server
backend.

## Database structure

`sql/init.sql` creates four PostgreSQL tables:

| Table          | Columns and role                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `users`        | `id`, `name`, unique `email`. Users who can reserve seats.                                                                 |
| `venues`       | `id`, `name`, `address`. Locations that host events.                                                                       |
| `events`       | `id`, `title`, `category`, `starts_at`, `capacity`, `venue_id`. Each event belongs to a venue.                             |
| `reservations` | `id`, `event_id`, `user_id`, `quantity`, `created_at`, nullable `cancelled_at`. Each reservation links a user to an event. |

```text
venues 1 ---- * events 1 ---- * reservations * ---- 1 users
```

All IDs are UUIDs. The domain requires lowercase UUID v7 identifiers. Foreign keys
connect events to venues and reservations to events and users. SQL constraints
require non-empty event titles and categories, positive capacity and positive
reservation quantities.

Indexes support event date/category filters and reservation lookups by event or
user. Only reservations without a cancellation timestamp count toward occupied seats.

### Default entries

PostgreSQL starts with the following records from `sql/init.sql`. There are no
seeded reservations.

| Record           | UUID v7                                | Details                                                                                |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Alice            | `01900000-0000-7000-8000-000000000001` | `alice@example.com`                                                                    |
| Bob              | `01900000-0000-7000-8000-000000000002` | `bob@example.com`                                                                      |
| Game room        | `01900000-0000-7000-8000-000000000003` | `12 rue du Jeu, Paris`                                                                 |
| Board game night | `01900000-0000-7000-8000-000000000004` | Category `gaming`, starts at `2099-06-15T18:00:00Z`, capacity 20, hosted in Game room. |

Compose runs the initialization SQL only when the PostgreSQL volume is empty.
To apply it manually to the current database:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/init.sql
```

Existing rows are kept. Rerunning this file does not reset edited records or migrate
an older schema.

### Inspect the database

Open http://localhost:8080 and select PostgreSQL:

| Field    | Value      |
| -------- | ---------- |
| Server   | `postgres` |
| Username | `events`   |
| Password | `events`   |
| Database | `events`   |

Adminer connects through the Compose service name `postgres`, not `localhost`.
These credentials and loopback-only service bindings are intended for local use.

### Older UUID-v4 data

Older demo data with UUID-v4 identifiers is incompatible with the current domain.
Back it up and run the data-preserving migration before rerunning the seed file:

```sh
docker compose exec -T postgres pg_dump -U events -d events > /tmp/events-before-uuid-v7.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-uuid-v7.sql
```

The migration updates identifiers and foreign keys in one transaction and prints
the old-to-new mapping. It preserves existing UUID-v7 records.

For disposable lesson data, you can reset the volumes instead. **This deletes all
local PostgreSQL and Valkey records.**

```sh
docker compose down -v
docker compose up -d --wait
```

## Checks

```sh
bun run check
bun run test
```

`check` verifies formatting, lint rules and TypeScript types. The test suite covers
application operations, REST endpoints and repository contracts. Repository tests
require Docker and use disposable containers, not the demo database.
