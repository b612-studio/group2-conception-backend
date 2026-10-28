# Day 2: Events REST API

A Hono API for events and reservations. REST controllers call application operations,
which enforce domain rules through a repository interface. PostgreSQL is the default;
Valkey and in-memory implementations are also available.

## Run locally

Requires Bun and Docker Compose. From this directory:

```sh
cp .env.example .env
bun install
docker compose up -d --wait
bun run dev
```

The API binds to http://127.0.0.1:3000. PostgreSQL runs on localhost:55432.
Change `POSTGRES_PORT` and `DATABASE_URL` together if needed. `ADMINER_PORT` configures
the database web interface. `PORT` sets the API port. No model API key is needed.

### Valkey alternative

Compose also provides `valkey/valkey:alpine` on localhost:56379, bound to loopback,
with append-only persistence in the `valkey_data` volume. Set these in `.env`:

```dotenv
EVENT_REPOSITORY=valkey
VALKEY_URL=redis://localhost:56379
VALKEY_PORT=56379
```

PostgreSQL remains the default. Valkey uses the same demo users and venue as
`sql/init.sql`, but starts with no events. Create an event through REST.
The two repositories store independent data; switching does not migrate it.
Change `VALKEY_PORT` and `VALKEY_URL` together if needed.

The Valkey adapter stores a single validated snapshot for this small demo.
Valibot pipelines encode and decode JSON and dates. An atomic Lua compare-and-set
retries concurrent writes, so capacity checks cannot overbook across API processes.
Mutation callbacks can run more than once and must not perform external side effects.
All records are read for each operation, so this design is not intended for large datasets.

The second implementation, `src/infrastructure/valkey-event-repository-functional.ts`,
reuses the codec and storage operations but composes `withTimeout(retry(attempt))`.
Select it with `EVENT_REPOSITORY=valkey-functional`. Retry uses asynchronous recursion
with injectable backoff and sleep functions, not a loop. Both versions retry only
compare-and-set contention, never business failures or infrastructure rejections.
The functional version defaults to 32 attempts and a 5-second deadline for the whole
mutation, including backoff. Cancellation stops future attempts and checks the signal
before writing. A command already sent to Valkey cannot be undone, so a timeout can
have an unknown write outcome. Do not blindly retry timed-out commands.

### Database web interface

Open http://localhost:8080 and select PostgreSQL:

| Field    | Value      |
| -------- | ---------- |
| Server   | `postgres` |
| Username | `events`   |
| Password | `events`   |
| Database | `events`   |

`postgres` is the Compose service name, not localhost inside Adminer.
Use SQL command to query the database or Import to load `sql/init.sql`.
These services bind to localhost and use demo credentials.

### SQL and UUID-v7 upgrade

`sql/init.sql` creates `users`, `venues`, `events`, and `reservations` and inserts demo
records. Compose runs it automatically only when the database volume is empty.
To execute it manually against the current schema:

```sh
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/init.sql
```

The domain requires lowercase UUID v7 identifiers. Previous v4 demo data is not
compatible. Rerunning the seed file does not migrate old rows. For disposable lesson
data, explicitly reset the volume, which deletes all local records:

```sh
docker compose down -v
docker compose up -d --wait
```

For existing data, back up the database and run the data-preserving migration instead:

```sh
docker compose exec -T postgres pg_dump -U events -d events > /tmp/events-before-uuid-v7.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-uuid-v7.sql
```

This converts legacy identifiers and their foreign keys in one transaction, preserving
reservations and ownership. It prints the old-to-new mapping for external references.
A collision with an already-existing target ID causes a rollback rather than data loss.
Rerunning the migration leaves UUID-v7 records unchanged. Run it before rerunning the
seed file on an old database. No database reset or migration is performed automatically.

If REST `/events` returns 500, check the server logs. Old UUID-v4 rows cannot be decoded
by the UUID-v7 domain mapper. The migration resolves this; changing the client request
or adding identity does not.

| Record       | UUID v7                                |
| ------------ | -------------------------------------- |
| Alice        | `01900000-0000-7000-8000-000000000001` |
| Bob          | `01900000-0000-7000-8000-000000000002` |
| Venue        | `01900000-0000-7000-8000-000000000003` |
| Gaming event | `01900000-0000-7000-8000-000000000004` |

## Architecture

```text
REST routes -> Controllers -> Application operations -> Repository
                                       |
                                  Domain rules
```

```text
src/
  bootstrap.ts          Composition root and local HTTP server
  app.ts                Hono delivery setup and HTTP error mapping
  routes/               REST routes and request validation
  controllers/          REST translation and application invocation
  application/          Focused handlers, reads, identity and repository interface
  domain/               Event and reservation rules; branded UUID-v7 identifiers
  shared-kernel/        Option and Result, without framework dependencies
  infrastructure/       PostgreSQL, Valkey and in-memory repositories, entity mappings
  presentation/         Valibot DTO schemas and domain-to-DTO presenters
  validation.ts         Valibot request schemas and branded ID conversion
sql/init.sql            PostgreSQL schema and seeds
```

Imports use `#/*`, configured in `package.json` and `tsconfig.json` as in `hono-deep`.
The domain and application layers do not depend on Hono or Valibot.
REST validates inputs and outputs at runtime using Valibot schemas.

### Errors as values and absence

Expected business failures are `Result<Value, Error>` values with `_tag: 'Success'`
or `_tag: 'Failure'`. Event creation, capacity checks, updates, reservation and cancellation
return results rather than throwing expected errors.

`Option<Value>` represents absence using `None` and `Some`. Repository lookups return
`Option<Event>`. Both domain `cancelledAt` and persistence-entity `cancelled_at` use
`Option<Date>`. SQL row decoding converts `NULL` to `None`; SQL writes convert it back
only at the driver boundary. JSON responses expose a timestamp or `null` as a wire contract.

Controllers translate failure Results into HTTP status codes. Unexpected infrastructure
failures still throw. Invalid response DTOs or corrupt stored data are server failures,
not invalid client requests.

### Persistence

`EventData` is camelCase domain state. `EventEntity` is the PostgreSQL representation.
Reservation entities decode database absence into Option. Explicit mappers keep these
representations separate from public DTOs.

`PostgresEventRepository` locks the event row before counting active reservations and
writing a booking or capacity change. Both operations use the same lock to prevent
concurrent overbooking. Returning Failure from the mutation callback performs no write.
Cancelling locks the reservation, checks ownership, and records the cancellation instead
of deleting it.

`InMemoryEventRepository` implements the same port for fast backend tests. Supply its
known user and venue IDs as sets, then pass it to `createServices`. It has no artificial
await between checking capacity and writing, so each mutation runs in one JS turn.
It is a test fake, not evidence that PostgreSQL transactions work.

## REST endpoints

| Endpoint                                          | Input                                                  |
| ------------------------------------------------- | ------------------------------------------------------ |
| `GET /events?category=gaming&after=...`           | Optional `category`, `after` query parameters          |
| `POST /events`                                    | `title`, `category`, `startsAt`, `capacity`, `venueId` |
| `GET /events/{eventId}`                           | Event ID in the path                                   |
| `PATCH /events/{eventId}`                         | Non-empty partial event body                           |
| `POST /events/{eventId}/reservations`             | `quantity`                                             |
| `GET /me/reservations`                            | No body                                                |
| `POST /reservations/{reservationId}/cancellation` | No body                                                |

Creation and reservation return 201. Other successful operations return 200.
Event creation supplies a `Location` header. Lists return arrays.

Requests reject unknown fields. Timestamps require a timezone. `after` is an exclusive
event-start filter, not a pagination cursor. Lists sort by date and ID. There is no pagination.
Events must start in the future, capacity and quantity must be positive 32-bit integers,
and capacity cannot fall below active reservations. Multiple reservations per user are allowed.
Cancellation is allowed after event start, belongs to its user, and cannot be repeated.

```sh
curl -i http://127.0.0.1:3000/events/01900000-0000-7000-8000-000000000004/reservations \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001' \
  -d '{"quantity":2}'
```

### Error contracts

Errors use a runtime-validated `ErrorDto`:

```json
{ "error": { "code": "CONFLICT", "message": "Not enough seats" } }
```

The API uses 400 for invalid input, 401 for missing or unknown demo identity, 404 for
missing resources, 409 for business conflicts, and 500 for unexpected failures.

### Demo identity and safety

Reservation operations use `X-User-Id`. This header is not authentication. Anyone can
impersonate a seeded user. Creating and editing events remain public for the lesson.
Add authentication, organizer permissions and rate limits before deploying outside this demo.

The server binds to loopback. No cross-origin browser UI is configured.
Writes are not idempotent: do not automatically retry a timed-out reservation call.

## Try requests with Yaak

Generate the collection with `bun run demo:export`, then import
`demo/yaak.postman_collection.json` using Yaak's Postman importer. It is a
Postman v2.1 interchange file, not a native Yaak workspace. Requests use concrete local
URLs and Alice's `X-User-Id` header on every request. There is no login session.

Reserve seats, inspect `/me/reservations`, then copy the reservation ID into the
cancellation request. Replace the literal `{{reservationId}}` placeholder if your
importer does not migrate collection variables. The collection also includes
requests demonstrating 400 validation errors and 409 overbooking conflicts.

## Checks and tests

```sh
bun run format
bun run lint:fix
bun run check
bun run test
bun run test:transports
bun run test:contract
```

Oxfmt targets 80 columns, with exceptions for unbreakable strings. Oxlint requires
braces around conditionals and loops. `check` checks formatting, lint rules and types.

`test` runs the whole suite and requires Docker for repository contracts.
`test:transports` runs REST tests against an ephemeral loopback HTTP server with an
in-memory repository. Domain, backend and retry tests also need no external database.
Tests never touch the demo database.

Tests execute Given/When/Then functions: `given(setup).when(action).then(assertion)`
passes typed fixtures and outcomes through the stages. Coverage includes domain Results,
UUID-v7 parsing, immutable updates, Option cancellation state, REST validation and status
mapping, concurrent last-seat booking, capacity rejection, ownership and repeated cancellation.

### Repository contract tests

`test/event-repository.test.ts` runs the same tests with `describe.each` against
three implementations: in-memory, PostgreSQL and the original Valkey adapter.
The functional Valkey variant is not part of this comparison.

Tests call the `EventRepository` interface directly, without application services
or handlers. They check returned values, persisted state, callback inputs,
reference errors, filtering and ordering, ownership and concurrent mutation
serialization. Callback failures must leave storage unchanged. Reserved seat
counts must include only active reservations for the requested event.

`test/support/event-repository-fixtures.ts` supplies the implementations and
resource lifecycle only. Testcontainers starts disposable PostgreSQL and Valkey
containers on random host ports. Each test starts with empty events and
reservations. Two independent clients exercise concurrent writes. The fixtures
close connections and stop containers after the suite. Compose, application data
and `.env` connection URLs are not used. Missing Docker fails the tests rather
than silently skipping adapters. SQL migrations are not covered by these tests.
