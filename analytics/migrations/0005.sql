ALTER TABLE calls ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN facebook_click INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN booking_adset TEXT;
ALTER TABLE calls ADD COLUMN booking_ad TEXT;
ALTER TABLE calls ADD COLUMN attribution_evidence TEXT;
UPDATE calls SET qualified=1 WHERE keyword_qualified=1;
