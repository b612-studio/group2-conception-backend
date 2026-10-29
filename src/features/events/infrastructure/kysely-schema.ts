import type { Generated } from 'kysely'
import type { EventEntity } from '#/features/events/infrastructure/event-entity.ts'
import type { ReservationEntity } from '#/features/events/infrastructure/reservation-entity.ts'

// Compile-time descriptions only. sql/init.sql still owns DDL and seeds.
export interface Database {
  users: { id: string; name: string; email: string }
  venues: { id: string; name: string; address: string }
  events: EventEntity
  reservations: Omit<ReservationEntity, 'created_at' | 'cancelled_at'> & {
    created_at: Generated<Date>
    cancelled_at: Generated<Date | null>
  }
}
