ALTER TABLE calls ADD COLUMN booking_source TEXT;
ALTER TABLE calls ADD COLUMN booking_campaign TEXT;
ALTER TABLE calls ADD COLUMN source_checked_at TEXT;
CREATE INDEX calls_source_day ON calls(booking_source,booked_day);
ALTER TABLE calls ADD COLUMN event_type_uri TEXT;
