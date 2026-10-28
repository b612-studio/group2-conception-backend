import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Query descriptions, not migrations. sql/init.sql owns constraints and indexes.
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
})

export const venues = pgTable('venues', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  address: text().notNull(),
})

export const events = pgTable('events', {
  id: uuid().primaryKey(),
  title: text().notNull(),
  category: text().notNull(),
  starts_at: timestamp({ withTimezone: true }).notNull(),
  capacity: integer().notNull(),
  venue_id: uuid().notNull(),
})

export const reservations = pgTable('reservations', {
  id: uuid().primaryKey(),
  event_id: uuid().notNull(),
  user_id: uuid().notNull(),
  quantity: integer().notNull(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  cancelled_at: timestamp({ withTimezone: true }),
})
