# Controllers

A controller translates between HTTP and application operations. It knows about
framework (Hono's) request context, response status codes and headers. It should not know how
to query PostgreSQL or decide whether a reservation fits.

[Routes](../routes/event-routes.ts) define URLs and validate incoming data.
The [event command controller](commands/event-controller.ts) receives validated
write input and calls command use cases. The
[event query controller](queries/event-controller.ts) calls event query use cases,
and the [user query controller](queries/user-controller.ts) lists reservations.
Controllers stay HTTP adapters; application use cases implement the shared
`CommandHandler` or `QueryHandler` interface without depending on Hono.

## Follow a reservation request

1. The route validates the event ID and quantity.
2. The controller resolves the demo identity from `X-User-Id`.
3. The reservation handler asks the repository to run a protected mutation.
4. The event checks the booking rules inside that mutation.
5. The controller passes the result to `httpResult`, which presents a success
   or translates an expected failure to an HTTP response.

The demo header is not authentication. It only selects a known user for this
lesson.

## Keep transport decisions here

Creation returns 201 and an event `Location` header. A booking conflict becomes 409. The domain returns a `Conflict` value, not a Hono `Response`.

[http-result.ts](http-result.ts) shares this result-to-response handling across
controllers. [Presenters](../presentation/dto-and-presenter.md) choose the body
shape; controllers arrange the HTTP response.

Do not move capacity checks into the controller. A future script or another
transport could call the same application operation without going through Hono.
Do not move transactions here either. Their scope must include the repository's
read, domain check and write.

The controller factory receives explicit use cases and the identity helper from
[the composition root](../composition-root.ts) instead of constructing them. This is [dependency injection](../application/dependency-injection.md)
at the HTTP boundary.
