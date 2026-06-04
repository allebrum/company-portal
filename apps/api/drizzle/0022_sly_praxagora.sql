ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS opportunity_status text NOT NULL DEFAULT 'pipeline';

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS opportunity_value integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_opportunity_status_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_opportunity_status_check
      CHECK (opportunity_status IN ('pipeline', 'won', 'lost', 'on-hold'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_opportunity_value_nonnegative_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_opportunity_value_nonnegative_check
      CHECK (opportunity_value IS NULL OR opportunity_value >= 0);
  END IF;
END $$;
