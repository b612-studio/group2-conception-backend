# Bounded contexts and feature folders

Events and Notifications use different models for different jobs. Events decides
whether someone can reserve seats. Notifications decides whether a recipient
gets an inbox item and who may read it. A bounded context is the boundary within
which a model and its vocabulary apply.

A folder alone does not create that boundary. If Notifications imported the
Events repository to load a user and update a reservation, the models would
still be coupled even with separate folders.

## Organize by capability, then by technical role

Before the feature split, top-level folders such as `domain`, `application` and
`controllers` grouped the code by technical role. With two capabilities, those
folders would mix booking rules with inbox rules.

Now `src/features/events` and `src/features/notifications` identify the
capabilities first. This is what "screaming architecture" means here. The first
folders a reader sees tell them what the application does. Inside each feature,
application code, domain rules and adapters still have distinct responsibilities.

The two trees do not need identical shapes. Events has separate controllers and
presenters. Notifications has a smaller HTTP router calling an application
service. Copying every Events layer into Notifications would add files without
establishing a stronger business boundary.

## The same person does not require the same entity

Events' user has a booking identity, name and email. Notifications' recipient has
its own ID, an opaque `bookingUserRef` and an inbox preference. Alice's seeded
booking ID ends in `0001`; her recipient ID ends in `0101`.

`bookingUserRef` connects the identities without making the recipient an Events
user. Notifications does not need the user's name, email or reservation methods
to manage an in-app inbox. Its repository accepts a string reference, not an
Events `UserId` or entity.

This separation has a cost. A booking user does not automatically become a
recipient. The demo seeds each context independently. If Notifications receives
a fact for an unknown reference, it ignores it rather than fetching the user
from Events. A real enrollment flow would need an explicit contract too.

Do not move `User` into the shared kernel just because both contexts refer to a
person. That would force both models to change together as soon as one needs a
new field or rule.

## Translate at the receiving boundary

Events owns its [published contract](events/contracts/events.ts). Notifications
has one [subscriber adapter](notifications/infrastructure/events-subscriber.ts)
that imports it. The adapter translates the vocabulary before calling the local
application service:

| Events fact            | Notifications input |
| ---------------------- | ------------------- |
| Envelope `messageId`   | `sourceMessageId`   |
| `userId`               | `bookingUserRef`    |
| `reservationId`        | `bookingRef`        |
| `quantity`             | `seats`             |
| `EventReserved`        | `kind: 'confirmed'` |
| `ReservationCancelled` | `kind: 'cancelled'` |

This adapter is an anti-corruption layer. Its job is to keep Events' vocabulary
out of Notifications' application and domain code. It is small because the
contracts are small, not because translation is optional.

`NotificationService.receive` accepts a local `BookingNotice`. It knows nothing
about `EventReserved`, the bus or Events' repositories. The adapter logs creation
and update facts but does not turn them into inbox items.

Only published data crosses the boundary. A recipient cannot follow `bookingRef`
through a Notifications repository to retrieve an Events reservation. If an inbox
message later needed an event title, the integration would need to supply that
data through a deliberate contract. Importing the Events repository would bypass
the boundary rather than extend it.

## Separate ownership without separate deployment

Both contexts run in one Bun process and use one PostgreSQL database. Events'
PostgreSQL adapters query `events.*`; Notifications queries `notifications.*`.
Foreign keys stay within each schema. Booking references in Notifications are
text, not foreign keys into Events.

Schemas express ownership here. They do not enforce access control, since the
demo uses one database role for both contexts. The composition root can see both
contexts to wire them together; that does not give either application service a
reason to import the other's model.

There is also no transaction spanning both contexts. Events saves the booking,
then publishes. Notifications handles the fact in a separate transaction. A
notification failure does not undo the booking. The
[event-bus guide](../infrastructure/messaging/event-bus.md) explains the resulting
delivery gaps and why duplicate suppression does not guarantee delivery.

This is a modular application, not a microservices deployment. Separate processes
would add network failures, serialization and deployment concerns. They would
not remove the need to decide who owns each rule.

## Keep the boundary checkable

The [boundary test](../../test/bounded-contexts.test.ts) checks the current
TypeScript import convention. Events must not import Notifications. The only
Notifications file allowed to import Events is the subscriber, and it may import
only the published contract. That contract must not import domain models.

This is a source-text check, not a complete dependency analyzer. It guards the
imports used in this lesson; it does not prove that arbitrary dynamic imports or
SQL joins respect ownership. Review repository SQL and new integration code with
the same rule in mind.

Shared technical types belong in the [shared kernel](../shared-kernel/shared-kernel.md).
Storage clients, DI registrations and the concrete bus belong in infrastructure.
Neither location should become a way to share business models indirectly.
