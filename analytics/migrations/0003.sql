-- Separate automated keyword eligibility from manually assessed sales qualification.
ALTER TABLE calls ADD COLUMN keyword_qualified INTEGER CHECK(keyword_qualified IN (0,1));
ALTER TABLE calls ADD COLUMN attendance_updated_at TEXT;
ALTER TABLE calls ADD COLUMN qualification_updated_at TEXT;
UPDATE calls SET keyword_qualified=qualified WHERE outcome_updated_at IS NULL;
UPDATE calls SET qualified=NULL WHERE outcome_updated_at IS NULL;
UPDATE calls SET attendance_updated_at=outcome_updated_at,qualification_updated_at=outcome_updated_at WHERE outcome_updated_at IS NOT NULL;
