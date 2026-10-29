import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type {
  ApplicationError,
  EventFilter,
  EventRepository,
} from '#/features/events/application/ports.ts'
import type { Event } from '#/features/events/domain/event.ts'
import type { Reservation } from '#/features/events/domain/reservation.ts'
import type {
  EventId,
  ReservationId,
  UserId,
} from '#/features/events/domain/ids.ts'
import { NotFound } from '#/features/events/domain/errors.ts'
import { Option } from '#/shared-kernel/option.ts'
import { Result } from '#/shared-kernel/result.ts'
import {
  eventToDomain,
  eventToEntity,
} from '#/features/events/infrastructure/event-entity.ts'
import {
  reservationFromRow,
  reservationToEntity,
} from '#/features/events/infrastructure/reservation-entity.ts'
import type { Database } from '#/features/events/infrastructure/kysely-schema.ts'
import { pgWrite } from '#/features/events/infrastructure/pg-write.ts'

export function createKyselyDatabase(url: string) {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: url }) }),
  }).withSchema('events')
}

export class KyselyEventRepository implements EventRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async listEvents(filter: EventFilter) {
    let query = this.db.selectFrom('events').selectAll()
    if (filter.category !== undefined) {
      query = query.where('category', '=', filter.category)
    }
    if (filter.after !== undefined) {
      query = query.where('starts_at', '>', filter.after)
    }
    const rows = await query.orderBy('starts_at').orderBy('id').execute()
    return rows.map(eventToDomain)
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const row = await this.db
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    return pgWrite(async () => {
      await this.db.insertInto('events').values(eventToEntity(event)).execute()
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
    return pgWrite(() =>
      this.db.transaction().execute(async (tx) => {
        const found = await this.lockEvent(tx, id)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const updated = change(found.value, await this.reservedSeats(tx, id))
        if (Result.isFailure(updated)) {
          return updated
        }
        await tx
          .updateTable('events')
          .set(eventToEntity(updated.value))
          .where('id', '=', id)
          .execute()
        return updated
      }),
    )
  }

  async reserve(
    eventId: EventId,
    create: (
      event: Event,
      reservedSeats: number,
    ) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return pgWrite(() =>
      this.db.transaction().execute(async (tx) => {
        const found = await this.lockEvent(tx, eventId)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const result = create(
          found.value,
          await this.reservedSeats(tx, eventId),
        )
        if (Result.isFailure(result)) {
          return result
        }
        const entity = reservationToEntity(result.value)
        await tx
          .insertInto('reservations')
          .values({
            ...entity,
            cancelled_at: Option.getOrNull(entity.cancelled_at),
          })
          .execute()
        return result
      }),
    )
  }

  async listReservations(userId: UserId) {
    const rows = await this.db
      .selectFrom('reservations')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('created_at')
      .orderBy('id')
      .execute()
    return rows.map(reservationFromRow)
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom('reservations')
        .selectAll()
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .forUpdate()
        .executeTakeFirst()
      if (row === undefined) {
        return Result.fail(new NotFound('Reservation not found'))
      }
      const updated = change(reservationFromRow(row))
      if (Result.isFailure(updated)) {
        return updated
      }
      const entity = reservationToEntity(updated.value)
      await tx
        .updateTable('reservations')
        .set({
          cancelled_at: Option.getOrNull(entity.cancelled_at),
        })
        .where('id', '=', id)
        .execute()
      return updated
    })
  }

  async userExists(id: UserId) {
    const row = await this.db
      .selectFrom('users')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst()
    return row !== undefined
  }

  private async lockEvent(
    tx: Kysely<Database>,
    id: EventId,
  ): Promise<Option<Event>> {
    const row = await tx
      .selectFrom('events')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  private async reservedSeats(tx: Kysely<Database>, eventId: EventId) {
    const row = await tx
      .selectFrom('reservations')
      .select((eb) => eb.fn.sum<string>('quantity').as('seats'))
      .where('event_id', '=', eventId)
      .where('cancelled_at', 'is', null)
      .executeTakeFirstOrThrow()
    // PostgreSQL SUM(integer) returns bigint, decoded by pg as a string.
    return Number(row.seats ?? 0)
  }
}
