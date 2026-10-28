# Domain entities

A domain entity represents something whose identity survives changes to its
attributes. An event can change title or capacity and still be the same event
because its `EventId` stays the same.

[Event](event.ts) and [Reservation](reservation.ts) are domain entities in this
lesson. They carry identifiers and business behavior. `Event.update` returns a
new object with the existing event ID. `Reservation.cancel` returns a reservation
with the existing reservation ID and a cancellation timestamp.

## Identity is not object reference

Immutability does not prevent a model from being an entity. Two JavaScript
objects can describe the same event at different points in time. Their domain
identity comes from the event ID, not `===` or whether they occupy the same memory.

Conversely, [Capacity](value-objects.md) is not an entity merely because it is a
class. It has no ID. Two capacities with the same seat limit are equal by value.

## Behavior belongs with the relevant rules

The event checks whether a booking fits and whether an edit would invalidate
existing reservations. The reservation checks whether it has already been
cancelled. They return new state or an expected failure; they do not write rows
or construct HTTP responses.

These entities are deliberately small. The repository supplies occupied-seat
counts, and the application supplies time. A public `Reservation` constructor
also means the application must validate booking inputs before construction.

## Database entities are a different use of the word

`EventEntity` in infrastructure means a persisted row shape. It uses database
column names and has no booking methods. It is not the domain entity despite
sharing an ID and much of the data.

See [database entities and mappings](../infrastructure/entities.md) for how the
repository converts between those representations and why it keeps both.
