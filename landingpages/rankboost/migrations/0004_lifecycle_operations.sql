ALTER TABLE leads ADD COLUMN calendly_provider_event_at_ms INTEGER;

ALTER TABLE calendly_invitees ADD COLUMN provider_event_at_ms INTEGER;
ALTER TABLE calendly_invitees ADD COLUMN old_invitee_uri TEXT;
ALTER TABLE calendly_invitees ADD COLUMN rescheduled_to_uri TEXT;
ALTER TABLE calendly_terminal_transitions ADD COLUMN provider_event_at_ms INTEGER;

ALTER TABLE integration_jobs ADD COLUMN source_resource TEXT;
ALTER TABLE integration_jobs ADD COLUMN source_status TEXT;

CREATE INDEX IF NOT EXISTS idx_calendly_invitees_lead_order
  ON calendly_invitees (lead_ref, provider_event_at_ms);
CREATE INDEX IF NOT EXISTS idx_calendly_invitees_old
  ON calendly_invitees (old_invitee_uri);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_source
  ON integration_jobs (source_resource, source_status, status);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_completed
  ON integration_jobs (status, completed_at, id);

CREATE TABLE IF NOT EXISTS integration_job_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  attempt_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'started', 'succeeded', 'failed', 'delivery_unknown',
      'lease_lost', 'requeued', 'skipped_stale'
    )
  ),
  http_status INTEGER,
  retryable INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_integration_job_attempts_job
  ON integration_job_attempts (job_id, created_at);

CREATE TABLE IF NOT EXISTS operational_alerts (
  alert_key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'acknowledged', 'resolved')
  ),
  severity TEXT NOT NULL DEFAULT 'error',
  job_id INTEGER,
  lead_ref TEXT,
  resource_key TEXT,
  message_code TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at TEXT,
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  next_notification_at TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_status_seen
  ON operational_alerts (status, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_operational_alerts_job_lead
  ON operational_alerts (job_id, lead_ref);

CREATE TABLE IF NOT EXISTS processor_leases (
  name TEXT PRIMARY KEY,
  lease_token TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_retention
  ON submissions (state, updated_at);
CREATE INDEX IF NOT EXISTS idx_usage_counters_retention
  ON usage_counters (updated_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_retention
  ON auth_attempts (created_at);
