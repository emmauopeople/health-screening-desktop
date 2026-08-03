CREATE TABLE local_sequences (
  key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value >= 1),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO local_sequences (key, next_value, updated_at)
SELECT
  'patient_code',
  COALESCE(
    MAX(
      CASE
        WHEN patient_code GLOB 'PT-[0-9][0-9][0-9][0-9][0-9][0-9]'
        THEN CAST(substr(patient_code, 4) AS INTEGER)
        ELSE NULL
      END
    ),
    0
  ) + 1,
  '1970-01-01T00:00:00.000Z'
FROM patients;

ALTER TABLE patient_identifiers
ADD COLUMN status TEXT NULL CHECK (
  status IS NULL OR status IN ('ACTIVE', 'INACTIVE', 'REPLACED')
);

CREATE INDEX ix_patients_date_of_birth
  ON patients (date_of_birth)
  WHERE date_of_birth IS NOT NULL;

CREATE INDEX ix_patients_approximate_age
  ON patients (approximate_age_years, age_as_of_date)
  WHERE approximate_age_years IS NOT NULL;

CREATE INDEX ix_patients_residence_search
  ON patients (village, quarter, name_normalized);

CREATE INDEX ix_patients_code_name
  ON patients (patient_code, name_normalized, id);

CREATE UNIQUE INDEX ux_patient_identifiers_active_local_code
  ON patient_identifiers (identifier_value)
  WHERE identifier_type = 'LOCAL_PATIENT_CODE'
    AND status = 'ACTIVE'
    AND valid_to IS NULL;

CREATE TRIGGER patients_hsd025_identity_insert
BEFORE INSERT ON patients
FOR EACH ROW
WHEN
  NEW.status = 'ACTIVE'
  AND (
    (NEW.date_of_birth IS NULL AND NEW.approximate_age_years IS NULL)
    OR (NEW.date_of_birth IS NOT NULL AND NEW.approximate_age_years IS NOT NULL)
    OR (NEW.approximate_age_years IS NOT NULL AND NEW.age_as_of_date IS NULL)
    OR (NEW.approximate_age_years IS NULL AND NEW.age_as_of_date IS NOT NULL)
    OR (NEW.approximate_age_years IS NOT NULL AND NEW.approximate_age_years > 120)
  )
BEGIN
  SELECT RAISE(ABORT, 'patients_hsd025_identity_insert');
END;

CREATE TRIGGER patients_hsd025_identity_update
BEFORE UPDATE OF status, date_of_birth, approximate_age_years, age_as_of_date ON patients
FOR EACH ROW
WHEN
  NEW.status = 'ACTIVE'
  AND (
    (NEW.date_of_birth IS NULL AND NEW.approximate_age_years IS NULL)
    OR (NEW.date_of_birth IS NOT NULL AND NEW.approximate_age_years IS NOT NULL)
    OR (NEW.approximate_age_years IS NOT NULL AND NEW.age_as_of_date IS NULL)
    OR (NEW.approximate_age_years IS NULL AND NEW.age_as_of_date IS NOT NULL)
    OR (NEW.approximate_age_years IS NOT NULL AND NEW.approximate_age_years > 120)
  )
BEGIN
  SELECT RAISE(ABORT, 'patients_hsd025_identity_update');
END;
