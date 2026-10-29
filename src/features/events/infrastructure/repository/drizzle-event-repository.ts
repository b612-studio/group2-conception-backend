import { and, asc, eq, gt, isNull, sum } from 'drizzle-orm'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
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
import {
  events,
  reservations,
  users,
} from '#/features/events/infrastructure/drizzle-schema.ts'
import { pgWrite } from '#/features/events/infrastructure/pg-write.ts'

export function createDrizzleDatabase(url: string) {
  const pool = new Pool({ connectionString: url })
  return { db: drizzle(pool), close: () => pool.end() }
}

export class DrizzleEventRepository implements EventRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async listEvents(filter: EventFilter) {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          filter.category === undefined
            ? undefined
            : eq(events.category, filter.category),
          filter.after === undefined
            ? undefined
            : gt(events.starts_at, filter.after),
        ),
      )
      .orderBy(asc(events.starts_at), asc(events.id))
    return rows.map(eventToDomain)
  }

  async findEvent(id: EventId): Promise<Option<Event>> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id))
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  async createEvent(event: Event): Promise<Result<Event, ApplicationError>> {
    return pgWrite(async () => {
      await this.db.insert(events).values(eventToEntity(event))
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
      this.db.transaction(async (tx) => {
        const found = await this.lockEvent(tx, id)
        if (Option.isNone(found)) {
          return Result.fail(new NotFound('Event not found'))
        }
        const updated = change(found.value, await this.reservedSeats(tx, id))
        if (Result.isFailure(updated)) {
          return updated
        }
        await tx
          .update(events)
          .set(eventToEntity(updated.value))
          .where(eq(events.id, id))
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
      this.db.transaction(async (tx) => {
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
        await tx.insert(reservations).values({
          ...entity,
          cancelled_at: Option.getOrNull(entity.cancelled_at),
        })
        return result
      }),
    )
  }

  async listReservations(userId: UserId) {
    const rows = await this.db
      .select()
      .from(reservations)
      .where(eq(reservations.user_id, userId))
      .orderBy(asc(reservations.created_at), asc(reservations.id))
    return rows.map(reservationFromRow)
  }

  async cancelReservation(
    id: ReservationId,
    userId: UserId,
    change: (reservation: Reservation) => Result<Reservation, ApplicationError>,
  ): Promise<Result<Reservation, ApplicationError>> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(reservations)
        .where(and(eq(reservations.id, id), eq(reservations.user_id, userId)))
        .for('update')
      if (row === undefined) {
        return Result.fail(new NotFound('Reservation not found'))
      }
      const updated = change(reservationFromRow(row))
      if (Result.isFailure(updated)) {
        return updated
      }
      const entity = reservationToEntity(updated.value)
      await tx
        .update(reservations)
        .set({
          cancelled_at: Option.getOrNull(entity.cancelled_at),
        })
        .where(eq(reservations.id, id))
      return updated
    })
  }

  async userExists(id: UserId) {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
    return rows.length > 0
  }

  private async lockEvent(
    tx: NodePgDatabase,
    id: EventId,
  ): Promise<Option<Event>> {
    const [row] = await tx
      .select()
      .from(events)
      .where(eq(events.id, id))
      .for('update')
    return Option.map(Option.fromNullable(row), eventToDomain)
  }

  private async reservedSeats(tx: NodePgDatabase, eventId: EventId) {
    const [row] = await tx
      .select({ seats: sum(reservations.quantity) })
      .from(reservations)
      .where(
        and(
          eq(reservations.event_id, eventId),
          isNull(reservations.cancelled_at),
        ),
      )
    return Number(row!.seats ?? 0)
  }
}
