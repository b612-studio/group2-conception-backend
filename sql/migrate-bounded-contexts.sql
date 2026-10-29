-- Run once for an existing Day 2 database before rerunning init.sql.
-- Moves the original tables without copying rows or changing their identifiers.
BEGIN;
CREATE SCHEMA IF NOT EXISTS events;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'venues', 'events', 'reservations'] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      IF to_regclass(format('events.%I', table_name)) IS NOT NULL THEN
        RAISE EXCEPTION 'Both public.% and events.% exist. Resolve the duplicate tables before migrating.', table_name, table_name;
      END IF;
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA events', table_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
