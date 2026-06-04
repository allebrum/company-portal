ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS project_overview jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_project_overview_object_check'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_project_overview_object_check
      CHECK (jsonb_typeof(project_overview) = 'object');
  END IF;
END $$;
