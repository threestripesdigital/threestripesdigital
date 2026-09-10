CREATE TABLE IF NOT EXISTS prebooking_sms (
 lead_ref TEXT PRIMARY KEY,
 offer TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT '',
 phone TEXT NOT NULL,
 first_name TEXT NOT NULL DEFAULT '',
 domain TEXT NOT NULL,
 booking_url TEXT NOT NULL,
 keyword TEXT NOT NULL DEFAULT '',
 position TEXT NOT NULL DEFAULT '',
 opp_value TEXT NOT NULL DEFAULT '',
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 stopped_at TEXT,
 stop_reason TEXT,
 reply_checked_at TEXT,
 roezan_contact_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_prebooking_sms_phone ON prebooking_sms(phone,started_at);
CREATE INDEX IF NOT EXISTS idx_prebooking_sms_email ON prebooking_sms(email,started_at);
