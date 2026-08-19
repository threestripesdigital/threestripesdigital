ALTER TABLE leads ADD COLUMN submission_id TEXT;
ALTER TABLE leads ADD COLUMN dataforseo_cost REAL NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN boost_live_at TEXT;
ALTER TABLE leads ADD COLUMN calendly_invitee_uri TEXT;
ALTER TABLE leads ADD COLUMN calendly_lifecycle_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_submission_id
  ON leads (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_domain_status_created
  ON leads (domain, status, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_calendly_invitee
  ON leads (calendly_invitee_uri);

CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'processing',
  lease_token TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  lead_ref TEXT,
  response_json TEXT,
  response_status INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_submissions_state_lease
  ON submissions (state, lease_until);

CREATE TABLE IF NOT EXISTS integration_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_ref TEXT,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_until TEXT,
  last_error TEXT,
  last_http_status INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  dead_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_integration_jobs_ready
  ON integration_jobs (status, available_at, id);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_lease
  ON integration_jobs (status, lease_until);
CREATE INDEX IF NOT EXISTS idx_integration_jobs_lead
  ON integration_jobs (lead_ref, created_at);

CREATE TABLE IF NOT EXISTS calendly_invitees (
  invitee_uri TEXT PRIMARY KEY,
  event_uri TEXT,
  event_type_uri TEXT NOT NULL,
  lead_ref TEXT,
  scheduled_start_at TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  poll_attempts INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  poll_lease_token TEXT,
  poll_lease_until TEXT,
  no_show_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendly_invitees_poll
  ON calendly_invitees (status, scheduled_start_at, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_calendly_invitees_lead
  ON calendly_invitees (lead_ref, created_at);

CREATE TABLE IF NOT EXISTS calendly_terminal_transitions (
  invitee_uri TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('canceled', 'no_show')),
  transition_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendly_terminal_status
  ON calendly_terminal_transitions (status, created_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
  endpoint TEXT NOT NULL,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_endpoint_ip_time
  ON auth_attempts (endpoint, ip, created_at);

CREATE TABLE IF NOT EXISTS usage_counters (
  scope TEXT NOT NULL,
  counter_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, counter_key, bucket)
);
