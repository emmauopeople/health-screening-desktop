CREATE TABLE patient_local_sequence (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  next_value INTEGER NOT NULL CHECK (next_value > 0),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO patient_local_sequence (singleton_id, next_value, updated_at)
VALUES (1, 1, '1970-01-01T00:00:00.000Z');

ALTER TABLE patients
ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1);

ALTER TABLE patient_identifiers
ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED'));

CREATE TABLE patient_recent_access (
  user_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  last_viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, patient_id),
  CONSTRAINT fk_patient_recent_access_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patient_recent_access_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE patient_duplicate_reviews (
  id TEXT PRIMARY KEY,
  patient_id_a TEXT NOT NULL,
  patient_id_b TEXT NOT NULL,
  pair_key TEXT NOT NULL,
  patient_a_row_version INTEGER NOT NULL CHECK (patient_a_row_version >= 1),
  patient_b_row_version INTEGER NOT NULL CHECK (patient_b_row_version >= 1),
  patient_a_identity_key TEXT NOT NULL CHECK (length(patient_a_identity_key) > 0),
  patient_b_identity_key TEXT NOT NULL CHECK (length(patient_b_identity_key) > 0),
  status TEXT NOT NULL CHECK (status IN ('NOT_DUPLICATE')),
  reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) = 1),
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  CONSTRAINT ck_patient_duplicate_reviews_distinct
    CHECK (patient_id_a <> patient_id_b),
  CONSTRAINT fk_patient_duplicate_reviews_patient_a FOREIGN KEY (patient_id_a)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patient_duplicate_reviews_patient_b FOREIGN KEY (patient_id_b)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patient_duplicate_reviews_reviewed_by FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_patients_birth_sex_name
  ON patients (date_of_birth, sex, name_normalized)
  WHERE date_of_birth IS NOT NULL;
CREATE INDEX ix_patients_age_sex_name
  ON patients (approximate_age_years, sex, name_normalized)
  WHERE approximate_age_years IS NOT NULL;
CREATE INDEX ix_patients_village_quarter
  ON patients (village, quarter, name_normalized);
CREATE INDEX ix_patient_identifiers_status
  ON patient_identifiers (patient_id, status, identifier_type);
CREATE INDEX ix_patient_recent_access_user_time
  ON patient_recent_access (user_id, last_viewed_at DESC, patient_id);
CREATE INDEX ix_patient_duplicate_reviews_pair_status
  ON patient_duplicate_reviews (pair_key, status);
CREATE UNIQUE INDEX ux_patient_duplicate_reviews_suppression
  ON patient_duplicate_reviews (
    pair_key,
    patient_a_identity_key,
    patient_b_identity_key,
    status
  );
CREATE INDEX ix_patient_duplicate_reviews_patient_a
  ON patient_duplicate_reviews (patient_id_a, reviewed_at DESC);
CREATE INDEX ix_patient_duplicate_reviews_patient_b
  ON patient_duplicate_reviews (patient_id_b, reviewed_at DESC);
