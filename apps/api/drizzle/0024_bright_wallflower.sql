ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_overview jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'clients_client_overview_object_check'
  ) THEN
    ALTER TABLE clients
      ADD CONSTRAINT clients_client_overview_object_check
      CHECK (jsonb_typeof(client_overview) = 'object');
  END IF;
END $$;
