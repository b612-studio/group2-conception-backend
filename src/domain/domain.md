# Domain

The domain models the rules and invariant of the business logic, independent of how a
request arrives or where data is stored.

[Event](event.ts) checks event data, prevents edits to started events, prevents
capacity reductions below occupied seats and rejects bookings that do not fit.
[Reservation](reservation.ts) records cancellation and rejects a second
cancellation. [Capacity](capacity.ts) represents a positive 32-bit seat limit.

These modules do not import Hono, Valibot or database clients. They return
[errors as values](../shared-kernel/errors-as-values.md) for expected rejections.

## Domain rules and application coordination

The domain does not load its own reservations to count occupied seats. The
application asks the repository to supply that count in a protected mutation,
then passes it to the event. This keeps storage access out of the model without
making the capacity check race against another write.

Likewise, methods receive `now` rather than reading the system clock. The
application supplies it through an injected `Clock`. Tests can check the exact
start-time boundary without waiting for real time to pass.

Not every business-related condition currently lives on an entity. For example,
[CreateEventUseCase](../application/commands/create-event.ts) requires a future start date.
`Event.create` accepts a past date because persistence must also reconstruct
events that have already happened. Construction and permission to create a new
event are different operations here.

## Different kinds of domain data

- [Entities](entities.md) have identity across changes. Updating an event does not
  create a new event ID.
- [Value objects](value-objects.md) describe a value without an identity. Two
  capacities of ten seats mean the same thing.
- [Branded types](branded-types.md) prevent TypeScript from confusing identifiers
  with the same underlying string representation.

A database row is a storage representation, not automatically a domain entity.
The [infrastructure mapping](../infrastructure/entities.md) separates those roles.

This is a small teaching model, not a claim that every rule is enforced by every
constructor. In particular, `Reservation` has a public constructor; the booking
handler checks quantity and event availability before constructing it.
