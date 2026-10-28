import type { Context } from 'hono'
import type {
  Clock,
  EventFilter,
  EventRepository,
  IdGenerator,
} from '#/domain/event-repository.ts'
import { Event, type EventInput } from '#/domain/event.ts'
import { Reservation } from '#/domain/reservation.ts'
import type { EventId, ReservationId } from '#/domain/ids.ts'
import { InvalidInput, NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import { requestUser } from '#/request.ts'
import { httpFailure, httpResult } from '#/controllers/http-result.ts'

export function createEventController(
  repository: EventRepository,
  clock: Clock,
  ids: IdGenerator,
) {
  const currentUser = (context: Context) =>
    requestUser(
      repository,
      Option.fromNullable(context.req.header('X-User-Id')),
    )
  return {
    list: async (context: Context, filter: EventFilter) =>
      context.json(
        (await repository.listEvents(filter)).map((event) => event.data),
      ),
    get: async (context: Context, id: EventId) => {
      const event = await repository.findEvent(id)
      if (Option.isNone(event)) {
        return httpFailure(context, new NotFound('Event not found'))
      }
      return context.json(event.value.data)
    },
    create: async (context: Context, input: EventInput) => {
      const event = Event.create({ ...input, id: ids.next<EventId>() })
      if (event._tag === 'Failure') {
        return httpFailure(context, event.error)
      }
      if (event.value.data.startsAt <= clock.now()) {
        return httpFailure(
          context,
          new InvalidInput('Event must start in the future'),
        )
      }
      const result = await repository.createEvent(event.value)
      if (result._tag === 'Success') {
        context.header('Location', `/events/${result.value.data.id}`)
      }
      return httpResult(context, result, (created) => created.data, 201)
    },
    update: async (context: Context, id: EventId, patch: Partial<EventInput>) =>
      httpResult(
        context,
        await repository.updateEvent(id, (event, seats) =>
          event.update(patch, seats, clock.now()),
        ),
        (event) => event.data,
      ),
    reserve: async (context: Context, eventId: EventId, quantity: number) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      const result = await repository.reserve(eventId, (event, seats) => {
        const now = clock.now()
        const checked = event.checkReservation(quantity, seats, now)
        if (checked._tag === 'Failure') {
          return checked
        }
        return Result.succeed(
          new Reservation({
            id: ids.next<ReservationId>(),
            eventId,
            userId: user.value,
            quantity,
            createdAt: now,
            cancelledAt: Option.none(),
          }),
        )
      })
      return httpResult(
        context,
        result,
        (reservation) => ({
          ...reservation.data,
          cancelledAt: Option.match(reservation.data.cancelledAt, {
            onNone: () => null,
            onSome: (date) => date,
          }),
        }),
        201,
      )
    },
    cancel: async (context: Context, id: ReservationId) => {
      const user = await currentUser(context)
      if (user._tag === 'Failure') {
        return httpFailure(context, user.error)
      }
      return httpResult(
        context,
        await repository.cancelReservation(id, user.value, (reservation) =>
          reservation.cancel(clock.now()),
        ),
        (reservation) => ({
          ...reservation.data,
          cancelledAt: Option.match(reservation.data.cancelledAt, {
            onNone: () => null,
            onSome: (date) => date,
          }),
        }),
      )
    },
  }
}
export type EventController = ReturnType<typeof createEventController>
