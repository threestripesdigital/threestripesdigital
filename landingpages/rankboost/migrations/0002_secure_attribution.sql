ALTER TABLE leads ADD COLUMN lead_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_lead_ref
  ON leads (lead_ref) WHERE lead_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS funnel_events (
  event_key TEXT PRIMARY KEY,
  lead_ref TEXT NOT NULL,
  event_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_lead_ref
  ON funnel_events (lead_ref, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_key TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
