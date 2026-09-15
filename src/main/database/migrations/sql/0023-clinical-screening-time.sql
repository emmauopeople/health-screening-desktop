-- Existing encounters keep their original time semantics. No data is rewritten.
ALTER TABLE screening_encounters ADD COLUMN clinical_time TEXT
  CHECK (clinical_time IS NULL OR json_valid(clinical_time));
ALTER TABLE screening_vitals_draft_readings ADD COLUMN measurement_date TEXT;
