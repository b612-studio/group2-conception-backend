# Value objects

A value object represents a domain value with its own rules. It has no identity
and is compared by meaning rather than by an ID.

[Capacity](capacity.ts) is our example. It wraps a positive integer no larger
than the PostgreSQL 32-bit integer limit. Its constructor is private;
`Capacity.create` returns either a valid capacity or an `InvalidInput` failure.
Zero, fractions, negative numbers and non-finite numbers cannot pass the factory.

## Why not leave capacity as a number

A plain `number` allows `0`, `NaN` and `1.5`. It also says nothing about what the
number represents. `Capacity` gives the validation rule one home and provides
`accommodates(seats)` for checking a seat count against the limit.

[Event.create](event.ts) accepts a numeric input and constructs the value object.
An event stores it as `event.data.capacity`. Updates construct a new event and
capacity rather than changing the existing capacity. `Event` still owns the
conflict messages and the rule that started events cannot be changed.

`accommodates` compares a supplied seat count to the limit. It does not validate
reservation quantity or fetch occupied seats. The event and application establish
those inputs. A value object should not acquire database dependencies just to
answer a domain question.

## Equality and immutability

Two calls to `Capacity.create(10)` produce separate objects. JavaScript reference
equality considers them different; `equals` compares their numeric values.
Replacing ten seats with another ten seats does not change its domain meaning.
There is no capacity ID to preserve.

The `value` property is readonly in TypeScript and there are no mutation methods.
This is a compile-time contract, not runtime freezing or a security boundary.

## Convert at boundaries

Application inputs, JSON responses and stored records still use numbers. The
[presenter](../presentation/event-presenter.ts) and
[persistence mapper](../infrastructure/event-entity.ts) extract `.value` explicitly.
Introducing the value object does not change the API or SQL schema.

An [entity](entities.md) has identity across changes. A
[brand](branded-types.md) distinguishes types at compile time but does not by
itself provide an object with behavior. These are separate modeling choices.
