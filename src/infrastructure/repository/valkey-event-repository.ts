import type { RedisClient } from 'bun'
import * as v from 'valibot'
import type {
  ApplicationError,
  EventFilter,
  EventRepository,
} from '#/application/ports.ts'
import { Event } from '#/domain/event.ts'
import { Reservation } from '#/domain/reservation.ts'
import { EventId, ReservationId, UserId, VenueId } from '#/domain/ids.ts'
import { InvalidInput, NotFound } from '#/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'

function stateSchema<const TDate extends v.GenericSchema>(dateSchema: TDate) {
  return v.strictObject({
    events: v.array(
      v.strictObject({
        id: v.string(),
        title: v.string(),
        category: v.string(),
        startsAt: dateSchema,
        capacity: v.number(),
        venueId: v.string(),
      }),
    ),
    reservations: v.array(
      v.strictObject({
        id: v.string(),
        eventId: v.string(),
        userId: v.string(),
        quantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
        createdAt: dateSchema,
        cancelledAt: v.nullable(dateSchema),
      }),
    ),
  })
}

const decodeState = v.pipe(
  v.string(),
  v.parseJson(),
  stateSchema(v.pipe(v.string(), v.isoTimestamp(), v.toDate())),
)
const encodeState = v.pipe(
  stateSchema(
    v.pipe(
      v.date(),
      v.transform((date) => date.toISOString()),
    ),
  ),
  v.stringifyJson(),
)

interface State {
  events: Event[]
  reservations: Reservation[]
}

// One snapshot keeps capacity checks and writes atomic across API processes.
// This is deliberately a small-demo adapter, not an indexed large-data store.
const compareAndSet = `
  local current = redis.call('GET', KEYS[1])
  if (current or '') ~= ARGV[1] then return 0 end
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
`

export type MutationAttempt<Value> = (
  signal?: AbortSignal,
) => Promise<Option<Value>>
export type RetryPolicy = <Value>(
  attempt: MutationAttempt<Value>,
) => Promise<Value>

async function iterativeRetry<Value>(
  attempt: MutationAttempt<Value>,
): Promise<Value> {
  for (let index = 0; index < 32; index++) {
    const result = await attempt()
    if (Option.isSome(result)) {
      return result.value
    }
    await Bun.sleep(Math.min(2 ** index, 50))
  }
  throw new Error('Valkey repository write contention exceeded retry limit')
}

export class ValkeyEventRepository implements EventRepository {
  constructor(
    private readonly client: RedisClient,
    private readonly references: {
      users: ReadonlySet<UserId>
      venues: ReadonlySet<VenueId>
    },
    private readonly key = 'events:repository:v1',
    private readonly retry: RetryPolicy = iterativeRetry,
  ) {}

  async listEvents(filter: EventFilter) {
    const { state } = await this.read()
    return state.events
      .filter(
        ({ data }) =>
          (filter.category === undefined ||
            data.category === filter.category) &&
          (filter.after === undefined || data.startsAt > filter.after),
      )
      .sort(
        (a, b) =>
          a.data.startsAt.getTime() - b.data.startsAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const { state } = await this.read()
    return Option.fromNullable(state.events.find(({ data }) => data.id === id))
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    return this.mutate((state) => {
      if (!this.references.venues.has(event.data.venueId)) {
        return this.invalidReference()
      }
      if (state.events.some(({ data }) => data.id === event.data.id)) {
        throw new Error('Duplicate event ID')
      }
      state.events.push(event)
      return Result.succeed(event)
    })
  }

  async updateEvent(
    id: EventId,
    change: (
      event: Event,
      reservedSeats: number,
    ) => Result<Event, ApplicationError>,
  ): Promise<Result<Event, ApplicationError>> {
    return this.mutate((state) => {
      const index = state.events.findIndex(({ data }) => data.id === id)
      const event = state.events[index]
      if (!event) {
        return Result.fail(new NotFound('Event not found'))
      }
      const changed = change(event, this.reservedSeats(state, id))
      if (changed._tag === 'Failure') {
        return changed
      }
      if (!this.references.venues.has(changed.value.data.venueId)) {
        return this.invalidReference()
      }
      state.events[index] = changed.value
      return changed
    })
  }

  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.mutate((state) => {
      const event = state.events.find(({ data }) => data.id === eventId)
      if (!event) {
        return Result.fail(new NotFound('Event not found'))
      }
      const result = create(event, this.reservedSeats(state, eventId))
      if (result._tag === 'Failure') {
        return result
      }
      if (!this.references.users.has(result.value.data.userId)) {
        return this.invalidReference()
      }
      if (
        state.reservations.some(({ data }) => data.id === result.value.data.id)
      ) {
        throw new Error('Duplicate reservation ID')
      }
      state.reservations.push(result.value)
      return result
    })
  }

  async listReservations(userId: UserId) {
    const { state } = await this.read()
    return state.reservations
      .filter(({ data }) => data.userId === userId)
      .sort(
        (a, b) =>
          a.data.createdAt.getTime() - b.data.createdAt.getTime() ||
          a.data.id.localeCompare(b.data.id),
      )
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.mutate((state) => {
      const index = state.reservations.findIndex(
        ({ data }) => data.id === id && data.userId === userId,
      )
      const reservation = state.reservations[index]
      if (!reservation) {
        return Result.fail(new NotFound('Reservation not found'))
      }
      const changed = change(reservation)
      if (changed._tag === 'Success') {
        state.reservations[index] = changed.value
      }
      return changed
    })
  }

  async userExists(id: UserId) {
    return this.references.users.has(id)
  }

  private invalidReference(): Result<never, ApplicationError> {
    return Result.fail(
      new InvalidInput('Referenced venue or user does not exist'),
    )
  }

  private reservedSeats(state: State, id: EventId) {
    return state.reservations
      .filter(
        ({ data }) => data.eventId === id && Option.isNone(data.cancelledAt),
      )
      .reduce((total, { data }) => total + data.quantity, 0)
  }

  private async read(): Promise<{ raw: string | null; state: State }> {
    const raw = await this.client.get(this.key)
    if (raw === null) {
      return { raw, state: { events: [], reservations: [] } }
    }
    const stored = v.parse(decodeState, raw)
    return {
      raw,
      state: {
        events: stored.events.map((data) =>
          Result.getOrThrow(
            Event.create({
              ...data,
              id: EventId.makeUnsafe(data.id),
              venueId: VenueId.makeUnsafe(data.venueId),
            }),
          ),
        ),
        reservations: stored.reservations.map(
          (data) =>
            new Reservation({
              ...data,
              id: ReservationId.makeUnsafe(data.id),
              eventId: EventId.makeUnsafe(data.eventId),
              userId: UserId.makeUnsafe(data.userId),
              cancelledAt: Option.fromNullable(data.cancelledAt),
            }),
        ),
      },
    }
  }

  // Callbacks may run again after contention and must have no external side effects.
  private async mutate<Value>(
    operation: (state: State) => Result<Value, ApplicationError>,
  ): Promise<Result<Value, ApplicationError>> {
    return this.retry<Result<Value, ApplicationError>>(async (signal) => {
      signal?.throwIfAborted()
      const { raw, state } = await this.read()
      signal?.throwIfAborted()
      const result = operation(state)
      if (result._tag === 'Failure') {
        return Option.some(result)
      }
      const next = v.parse(encodeState, {
        events: state.events.map(({ data }) => ({
          ...data,
          capacity: data.capacity.value,
        })),
        reservations: state.reservations.map(({ data }) => ({
          ...data,
          cancelledAt: Option.getOrNull(data.cancelledAt),
        })),
      })
      signal?.throwIfAborted()
      const saved: unknown = await this.client.send('EVAL', [
        compareAndSet,
        '1',
        this.key,
        raw ?? '',
        next,
      ])
      return saved === 1 ? Option.some(result) : Option.none()
    })
  }
}
