CREATE TEMP TABLE IF NOT EXISTS screening_encounter_identity_duplicate_guard (
  duplicate_count INTEGER NOT NULL CHECK (duplicate_count = 0)
) STRICT;

DELETE FROM temp.screening_encounter_identity_duplicate_guard;

INSERT INTO temp.screening_encounter_identity_duplicate_guard (duplicate_count)
SELECT COUNT(*)
FROM (
  SELECT 1
  FROM screening_encounters
  WHERE amendment_of_encounter_id IS NULL
  GROUP BY screening_session_id, patient_id
  HAVING COUNT(*) > 1
);

DROP TABLE temp.screening_encounter_identity_duplicate_guard;

CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
  ON screening_encounters (screening_session_id, patient_id)
  WHERE amendment_of_encounter_id IS NULL;
