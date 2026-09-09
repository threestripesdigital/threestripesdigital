CREATE TABLE IF NOT EXISTS appointment_followup (
  invitee_uri TEXT PRIMARY KEY,
  lead_ref TEXT NOT NULL,
  offer TEXT NOT NULL,
  email TEXT NOT NULL,
  kit_subscriber_id INTEGER,
  phone TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  journey_started_at TEXT NOT NULL,
  booked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TEXT,
  reply_checked_at TEXT,
  roezan_contact_id INTEGER,
  stopped_at TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointment_followup_lead ON appointment_followup(lead_ref, booked_at);
CREATE TABLE IF NOT EXISTS sms_suppression (
  phone TEXT PRIMARY KEY,
  suppressed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sms_reply_receipts (
  receipt TEXT PRIMARY KEY,
  invitee_uri TEXT NOT NULL,
  received_at TEXT NOT NULL,
  classification TEXT NOT NULL
);
