-- Restricted role the app switches to for every tenant query (docs/decisions/0003).
-- It cannot bypass row-level security. The connecting (owner) user switches to it with
-- `SET LOCAL ROLE fulcra_app` inside each tenant transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fulcra_app') THEN
    CREATE ROLE fulcra_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT fulcra_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fulcra_app;
--> statement-breakpoint
-- Tables created later by the migration user are usable by the app role automatically.
-- Which rows it can see is decided by each table's RLS policies.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fulcra_app;
--> statement-breakpoint
-- On Supabase, the public API roles must not reach our tables at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
