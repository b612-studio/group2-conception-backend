# Application services

An application service coordinates a capability that the application offers to
its callers. It loads the required state, asks the domain to make decisions,
persists the outcome and coordinates effects. Its callers can be HTTP handlers,
event subscribers, scheduled jobs or tests.

The word "service" does not mean a separate process or HTTP server. This
[NotificationService](notification-service.ts) is an ordinary TypeScript class
inside the same process as Events. Its bounded context comes from the model and
rules it owns, not from deploying it separately.

## Follow a booking notification

A successful reservation takes this path:

```text
Events ReserveEventUseCase
  -> persist the reservation
  -> publish EventReserved through the bus
  -> Notifications eventsSubscriber translates the published fact
  -> NotificationService.receive accepts a local BookingNotice
  -> load the recipient and inspect their inbox preference
  -> compose a Notification or choose suppression
  -> record the message once through NotificationRepository
```

The [subscriber](../infrastructure/events-subscriber.ts) understands Events'
published vocabulary. It translates `userId` into `bookingUserRef` and
`reservationId` into `bookingRef`. The application service only sees a local
`BookingNotice`. It does not import an Events entity or fetch a booking to finish
its work. This translation prevents another context's model from defining our
application API.

`receive` loads the recipient through a port. An unknown booking-user reference
does not implicitly enroll a recipient. An opted-out recipient does not receive
an inbox item. For an enabled recipient, the service calls
[composeNotification](../domain/notification.ts) to construct the message.

Finally, it calls `recordOnce`. The repository atomically records the source
message ID with the optional inbox item. Atomicity belongs in the adapter rather
than a fragile application sequence of "check whether processed, then insert".
Two concurrent deliveries must not both pass a separate pre-check. Suppression
also records the message ID, so opting back in does not deliver old messages on
replay.

## Application service versus domain service

An application service coordinates an operation. Domain behavior decides what a
business concept means and which changes are valid.

In Events, [Event.checkReservation](../../events/domain/event.ts) checks whether
seats can be reserved at the supplied time. It does not open a transaction or
publish a message. The
[ReserveEventUseCase](../../events/application/commands/reserve-event.ts) arranges
the repository operation, passes the occupied-seat count and clock time to that
domain behavior, constructs the reservation and publishes the committed fact.

A domain service is useful when a business rule spans domain concepts and has no
natural entity or value-object owner. It should use domain vocabulary and avoid
HTTP, database clients and event-bus delivery concerns. This lesson does not need
a separate domain-service class for notification text. `composeNotification` is
a pure domain function. Adding "Service" to its name would not make it more useful.

Do not put every rule in an application service just because it already has the
dependencies. Keep reusable business decisions in the domain. Conversely, do not
make an entity resolve repositories or publish messages to hide orchestration.

## Application service versus controller and adapter

| Responsibility                                                    | Owner in this example           |
| ----------------------------------------------------------------- | ------------------------------- |
| Parse JSON and the demo identity header, choose HTTP status codes | Notifications routes            |
| Translate another context's event into a local input              | Events subscriber adapter       |
| Coordinate recipient lookup, composition and persistence          | NotificationService             |
| Define the notification's subject and body                        | Domain composition function     |
| Execute SQL and enforce atomic duplicate suppression              | Notification repository adapter |

The application service has no Hono context, request, response or SQL client.
Constructor wiring and the composition root are covered in the existing
[dependency injection guide](../../events/application/dependency-injection.md).
This guide concerns what the service coordinates, not how its dependencies arrive.

## One service or one handler per operation?

Both styles in this lesson are application-layer orchestration:

- Events uses focused command and query handlers such as `ReserveEventUseCase`.
  Each handler has one `execute` operation and only its required dependencies.
- Notifications groups related operations in `NotificationService`, including
  receiving a notice, changing preferences, listing the inbox and marking read.

A class name is not an architectural distinction. A use-case handler is a focused
application service. A cohesive service with several methods is another way to
organize the same role. Split it when operations acquire unrelated dependencies
or policies, not merely to increase the number of classes.

Some methods here delegate directly to a repository. That is intentional. Listing
an inbox does not need invented orchestration or a domain object with no behavior.
The application boundary still keeps callers independent of SQL and storage choice.

## Transaction and failure boundaries

An application service is not automatically one database transaction. This
service reads a recipient before recording a message; concurrent preference
changes do not cancel a receive operation already using an earlier preference.
The atomic guarantee covers recording one source message and its inbox item.

Events commits its reservation before it publishes. Notifications uses a separate
transaction in its own schema. If a subscriber fails, the in-memory bus logs the
failure and does not roll back the booking. There is no distributed transaction.
Duplicate suppression makes repeated delivery safe, but does not guarantee that
delivery happens. Durable delivery would require an outbox and retry mechanism.

The [notification tests](../../../../test/notifications.test.ts) exercise the same
application behavior with memory and PostgreSQL repositories, plus an HTTP scenario
that starts with an Events booking and ends in a Notifications inbox.
