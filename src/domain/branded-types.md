# Branded types

TypeScript normally treats two aliases for `string` as interchangeable. That
would let us pass a venue ID where an event ID is required.

[ids.ts](ids.ts) adds a unique-symbol brand to each identifier type. `EventId`,
`UserId`, `ReservationId` and `VenueId` remain strings at runtime, but TypeScript
treats their brands as different types.

```ts
const eventId = EventId.make()
const venueId = VenueId.make()
// A function requiring EventId accepts eventId, not venueId.
```

The example assumes both identifier companions are imported from `ids.ts`.

## Validation is separate from branding

A brand disappears when TypeScript compiles. It cannot inspect a request string.
The companion's `parse` method performs the runtime work: it checks that the input
is a lowercase UUID v7 and returns a `Result`.

`make` generates a UUID v7. `makeUnsafe` parses and throws on failure, which is
appropriate for known fixture constants or stored identifiers that must already
be valid. Request validation should report invalid input rather than throw through
an unsafe constructor.

An assertion such as `input as EventId` bypasses the check. Prefer the companion
functions at boundaries. The exported generic `makeId<Id>` also trusts its type
argument, so callers must request the intended identifier type.

## What a brand does not prove

A valid `EventId` does not prove an event exists. A `UserId` does not establish
identity or authorization. Those questions still require application and storage
checks.

Brands distinguish identifier roles without wrapping every string in an object.
[Value objects](value-objects.md) are useful when a value needs its own validation
and behavior, as capacity does. Neither technique replaces a
[domain entity's](entities.md) identity and lifecycle.
