ALTER TABLE integration_jobs ADD COLUMN depends_on_dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_integration_jobs_dependency
  ON integration_jobs (depends_on_dedupe_key, status);
