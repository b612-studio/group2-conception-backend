# Database entities and domain entities

The word entity has two meanings in this project. Keep the meanings separate
when reading the code or discussing a change.

|          | Database entity          | Domain entity                         |
| -------- | ------------------------ | ------------------------------------- |
| Example  | `EventEntity`            | `Event`                               |
| Job      | Describe a stored record | Represent identity and business rules |
| Naming   | `starts_at`, `venue_id`  | `startsAt`, `venueId`                 |
| Capacity | Numeric column value     | `Capacity` value object               |
| Behavior | No booking behavior      | Checks bookings and edits             |

Both describe an event, but they answer different questions. The database needs
columns, foreign keys and serializable values. The domain needs concepts and
rules that do not depend on a query library.

## Mapping explicitly

[event-entity.ts](event-entity.ts) is a Mapper it owns conversion for events:

- `eventToDomain` parses stored IDs and calls `Event.create`, which validates
  the data and constructs a `Capacity`.
- `eventToEntity` converts the domain data to column names and extracts the
  numeric capacity.

[reservation-entity.ts](reservation-entity.ts) performs the corresponding mapping
for reservations, including nullable cancellation timestamps and domain `Option`.

Stored invalid identifiers or event data cause these mappings to throw. That
signals a persistence invariant violation, not an expected user rejection. An
adapter must not silently return a partially valid domain object.

## Database constraints still matter

Domain checks provide business behavior, but they do not replace SQL constraints
or concurrent-write protection. Another client might write directly to the
database. Two valid requests can also conflict when they run at the same time.

`sql/init.sql` owns PostgreSQL tables and constraints. Kysely and Drizzle describe
those tables for queries; neither schema declaration turns a row into our domain
`Event` or replaces the [repository's](repository/repository-pattern.md) transaction
requirements.

A response DTO is a third representation. It belongs to the
[presenter](../presentation/dto-and-presenter.md), not to a row mapping. Changing
the database column names should not force an HTTP response change.
