CREATE TABLE patient_demographic_amendments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  prior_row_version INTEGER NOT NULL CHECK (prior_row_version >= 1),
  resulting_row_version INTEGER NOT NULL CHECK (
    resulting_row_version = prior_row_version + 1
  ),
  reason_code TEXT NOT NULL CHECK (
    reason_code IN (
      'DATA_ENTRY_CORRECTION',
      'PATIENT_REPORTED_CHANGE',
      'CONTACT_INFORMATION_UPDATE',
      'RESIDENCE_INFORMATION_UPDATE',
      'STATUS_CHANGE',
      'OTHER'
    )
  ),
  reason_note TEXT NULL CHECK (reason_note IS NULL OR length(reason_note) <= 500),
  amended_by TEXT NOT NULL,
  amended_at TEXT NOT NULL,
  CONSTRAINT ck_patient_demographic_amendments_other_note
    CHECK (
      reason_code <> 'OTHER'
      OR (reason_note IS NOT NULL AND length(trim(reason_note)) > 0)
    ),
  CONSTRAINT ux_patient_demographic_amendments_patient_resulting_row_version
    UNIQUE (patient_id, resulting_row_version),
  CONSTRAINT fk_patient_demographic_amendments_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patient_demographic_amendments_amended_by FOREIGN KEY (amended_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE patient_demographic_amendment_changes (
  amendment_id TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (
    field_name IN (
      'given_name',
      'family_name',
      'other_names',
      'date_of_birth',
      'approximate_age_years',
      'age_as_of_date',
      'sex',
      'village',
      'quarter',
      'phone',
      'alternate_contact_name',
      'alternate_contact_phone',
      'residence_notes',
      'status'
    )
  ),
  -- Application code must write canonical JSON serialization before insert.
  previous_value_json TEXT NOT NULL CHECK (
    json_valid(previous_value_json) = 1
    AND json_type(previous_value_json) IN ('null', 'integer', 'real', 'text')
  ),
  new_value_json TEXT NOT NULL CHECK (
    json_valid(new_value_json) = 1
    AND json_type(new_value_json) IN ('null', 'integer', 'real', 'text')
  ),
  CONSTRAINT ck_patient_demographic_amendment_changes_distinct_values
    CHECK (previous_value_json <> new_value_json),
  PRIMARY KEY (amendment_id, field_name),
  CONSTRAINT fk_patient_demographic_amendment_changes_amendment FOREIGN KEY (amendment_id)
    REFERENCES patient_demographic_amendments (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_patient_demographic_amendments_patient_time
  ON patient_demographic_amendments (patient_id, amended_at DESC, id DESC);

CREATE INDEX ix_patient_demographic_amendment_changes_field
  ON patient_demographic_amendment_changes (field_name, amendment_id);

CREATE TRIGGER tr_patient_demographic_amendments_no_update
BEFORE UPDATE ON patient_demographic_amendments
BEGIN
  SELECT RAISE(ABORT, 'patient demographic amendments are append-only');
END;

CREATE TRIGGER tr_patient_demographic_amendments_no_delete
BEFORE DELETE ON patient_demographic_amendments
BEGIN
  SELECT RAISE(ABORT, 'patient demographic amendments are append-only');
END;

CREATE TRIGGER tr_patient_demographic_amendment_changes_no_update
BEFORE UPDATE ON patient_demographic_amendment_changes
BEGIN
  SELECT RAISE(ABORT, 'patient demographic amendment changes are append-only');
END;

CREATE TRIGGER tr_patient_demographic_amendment_changes_no_delete
BEFORE DELETE ON patient_demographic_amendment_changes
BEGIN
  SELECT RAISE(ABORT, 'patient demographic amendment changes are append-only');
END;

ALTER TABLE consent_records
ADD COLUMN patient_prior_row_version INTEGER NULL CHECK (
  patient_prior_row_version IS NULL OR patient_prior_row_version >= 1
);

ALTER TABLE consent_records
ADD COLUMN patient_resulting_row_version INTEGER NULL CHECK (
  patient_resulting_row_version IS NULL OR patient_resulting_row_version >= 2
) CHECK (
  (
    patient_prior_row_version IS NULL
    AND patient_resulting_row_version IS NULL
  )
  OR (
    patient_prior_row_version IS NOT NULL
    AND patient_resulting_row_version IS NOT NULL
    AND patient_resulting_row_version = patient_prior_row_version + 1
  )
);

CREATE INDEX ix_consent_records_registry_ack_history
  ON consent_records (patient_id, consent_type, recorded_at DESC, id DESC);

CREATE TRIGGER tr_consent_records_registry_acknowledgment_no_update
BEFORE UPDATE ON consent_records
WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
  OR NEW.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
BEGIN
  SELECT RAISE(ABORT, 'registry acknowledgment records are append-only');
END;

CREATE TRIGGER tr_consent_records_registry_acknowledgment_no_delete
BEFORE DELETE ON consent_records
WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
BEGIN
  SELECT RAISE(ABORT, 'registry acknowledgment records are append-only');
END;
