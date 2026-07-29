CREATE TABLE installation (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  id TEXT NOT NULL UNIQUE,
  deployment_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json) = 1),
  updated_at TEXT NOT NULL,
  sensitivity_classification TEXT NOT NULL
) STRICT;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER')),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL CHECK (must_change_password IN (0, 1)),
  failed_login_count INTEGER NOT NULL CHECK (failed_login_count >= 0),
  locked_until TEXT NULL,
  last_login_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (length(location_type) > 0),
  village TEXT NULL,
  subdivision TEXT NULL,
  region TEXT NULL,
  directions TEXT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_locations_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_locations_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE protocol_versions (
  id TEXT PRIMARY KEY,
  protocol_key TEXT NOT NULL,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
  effective_at TEXT NULL,
  configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json) = 1),
  checksum TEXT NOT NULL,
  imported_by TEXT NULL,
  imported_at TEXT NOT NULL,
  activated_by TEXT NULL,
  activated_at TEXT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_protocol_versions_imported_by FOREIGN KEY (imported_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_protocol_versions_activated_by FOREIGN KEY (activated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE patients (
  id TEXT PRIMARY KEY,
  patient_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  given_name TEXT NULL,
  family_name TEXT NULL,
  other_names TEXT NULL,
  name_normalized TEXT NOT NULL,
  sex TEXT NULL,
  date_of_birth TEXT NULL,
  approximate_age_years INTEGER NULL CHECK (
    approximate_age_years IS NULL OR approximate_age_years >= 0
  ),
  age_as_of_date TEXT NULL,
  phone TEXT NULL,
  phone_normalized TEXT NULL,
  alternate_contact_name TEXT NULL,
  alternate_contact_phone TEXT NULL,
  village TEXT NULL,
  quarter TEXT NULL,
  residence_notes TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_patients_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patients_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE patient_identifiers (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  issuer TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
  valid_from TEXT NULL,
  valid_to TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_patient_identifiers_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_patient_identifiers_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  consent_type TEXT NOT NULL CHECK (length(consent_type) > 0),
  status TEXT NOT NULL CHECK (length(status) > 0),
  source_type TEXT NOT NULL CHECK (length(source_type) > 0),
  effective_at TEXT NULL,
  withdrawn_at TEXT NULL,
  notes TEXT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT fk_consent_records_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_consent_records_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE screening_sessions (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  protocol_version_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT NULL,
  closed_at TEXT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_screening_sessions_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_protocol_version FOREIGN KEY (protocol_version_id)
    REFERENCES protocol_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_closed_by FOREIGN KEY (closed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE screening_encounters (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  screening_session_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  protocol_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'COMPLETED', 'AMENDED', 'VOID')),
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  summary_systolic INTEGER NULL CHECK (summary_systolic IS NULL OR summary_systolic > 0),
  summary_diastolic INTEGER NULL CHECK (summary_diastolic IS NULL OR summary_diastolic > 0),
  summary_pulse INTEGER NULL CHECK (summary_pulse IS NULL OR summary_pulse > 0),
  next_action_category TEXT NULL,
  decision_json TEXT NULL CHECK (decision_json IS NULL OR json_valid(decision_json) = 1),
  amendment_of_encounter_id TEXT NULL,
  amendment_reason TEXT NULL,
  void_reason TEXT NULL,
  record_version INTEGER NOT NULL CHECK (record_version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_screening_encounters_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounters_session FOREIGN KEY (screening_session_id)
    REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounters_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounters_protocol_version FOREIGN KEY (protocol_version_id)
    REFERENCES protocol_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounters_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounters_amendment FOREIGN KEY (amendment_of_encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE blood_pressure_readings (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  systolic INTEGER NOT NULL CHECK (systolic > 0),
  diastolic INTEGER NOT NULL CHECK (diastolic > 0),
  pulse INTEGER NULL CHECK (pulse IS NULL OR pulse > 0),
  arm TEXT NULL,
  body_position TEXT NULL,
  cuff_size TEXT NULL,
  device_identifier TEXT NULL,
  measured_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'DISCARDED')),
  discard_reason TEXT NULL,
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT fk_blood_pressure_readings_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_blood_pressure_readings_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_logs (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  question_code TEXT NOT NULL,
  response_code TEXT NULL,
  response_text TEXT NULL,
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT ux_lifestyle_logs_encounter_question UNIQUE (encounter_id, question_code),
  CONSTRAINT fk_lifestyle_logs_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_logs_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE food_logs (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  food_code TEXT NULL,
  food_name TEXT NOT NULL,
  food_name_normalized TEXT NOT NULL,
  frequency_code TEXT NULL,
  notes TEXT NULL,
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT fk_food_logs_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_logs_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE otc_medication_logs (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_name_normalized TEXT NOT NULL,
  reason_for_use TEXT NOT NULL,
  dose_text TEXT NULL,
  frequency_text TEXT NULL,
  duration_text TEXT NULL,
  source_of_medication TEXT NULL,
  currently_taking INTEGER NULL CHECK (currently_taking IS NULL OR currently_taking IN (0, 1)),
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT fk_otc_medication_logs_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_medication_logs_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE referrals (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  protocol_version_id TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) = 1),
  reason_text TEXT NULL,
  urgency TEXT NOT NULL,
  destination_name TEXT NULL,
  due_date TEXT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED')
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  printed_at TEXT NULL,
  closed_by TEXT NULL,
  closed_at TEXT NULL,
  closure_reason TEXT NULL,
  record_version INTEGER NOT NULL CHECK (record_version >= 1),
  updated_at TEXT NOT NULL,
  CONSTRAINT fk_referrals_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_referrals_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_referrals_protocol_version FOREIGN KEY (protocol_version_id)
    REFERENCES protocol_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_referrals_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_referrals_closed_by FOREIGN KEY (closed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE referral_status_history (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL,
  from_status TEXT NULL CHECK (
    from_status IS NULL
    OR from_status IN ('OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED')
  ),
  to_status TEXT NOT NULL CHECK (
    to_status IN ('OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED')
  ),
  change_reason TEXT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  CONSTRAINT fk_referral_status_history_referral FOREIGN KEY (referral_id)
    REFERENCES referrals (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_referral_status_history_changed_by FOREIGN KEY (changed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE followups (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL,
  contact_date TEXT NOT NULL,
  contact_method TEXT NOT NULL,
  information_source TEXT NOT NULL,
  provider_seen INTEGER NULL CHECK (provider_seen IS NULL OR provider_seen IN (0, 1)),
  facility_name TEXT NULL,
  date_seen TEXT NULL,
  reported_outcome TEXT NULL,
  reported_medications_or_advice TEXT NULL,
  next_action TEXT NULL,
  next_followup_date TEXT NULL,
  source_type TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CONSTRAINT fk_followups_referral FOREIGN KEY (referral_id)
    REFERENCES referrals (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_followups_recorded_by FOREIGN KEY (recorded_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE sync_outbox (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) = 1),
  payload_schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'IN_FLIGHT', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  next_attempt_at TEXT NULL,
  last_error_code TEXT NULL,
  last_error_message TEXT NULL,
  sent_at TEXT NULL
) STRICT;

CREATE TABLE sync_attempts (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NULL,
  status TEXT NOT NULL,
  item_counts_json TEXT NOT NULL CHECK (json_valid(item_counts_json) = 1),
  error_summary TEXT NULL
) STRICT;

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  user_id TEXT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NULL,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json) = 1),
  CONSTRAINT fk_audit_log_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX ux_users_username_normalized ON users (username_normalized);
CREATE INDEX ix_locations_name_normalized ON locations (name_normalized);
CREATE UNIQUE INDEX ux_protocol_versions_key_version
  ON protocol_versions (protocol_key, version_label);
CREATE UNIQUE INDEX ux_protocol_versions_one_active
  ON protocol_versions ((1))
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX ux_screening_sessions_location_date
  ON screening_sessions (location_id, session_date);
CREATE UNIQUE INDEX ux_patients_patient_code ON patients (patient_code);
CREATE INDEX ix_patients_name_normalized ON patients (name_normalized);
CREATE INDEX ix_patients_phone_normalized
  ON patients (phone_normalized)
  WHERE phone_normalized IS NOT NULL;
CREATE UNIQUE INDEX ux_patient_identifiers_identity
  ON patient_identifiers (identifier_type, issuer, identifier_value);
CREATE INDEX ix_patient_identifiers_patient ON patient_identifiers (patient_id);
CREATE INDEX ix_consent_records_patient_time
  ON consent_records (patient_id, recorded_at DESC);
CREATE INDEX ix_screening_encounters_patient_time
  ON screening_encounters (patient_id, started_at DESC);
CREATE INDEX ix_screening_encounters_session
  ON screening_encounters (screening_session_id);
CREATE UNIQUE INDEX ux_bp_readings_encounter_sequence
  ON blood_pressure_readings (encounter_id, sequence_number);
CREATE INDEX ix_lifestyle_logs_encounter ON lifestyle_logs (encounter_id);
CREATE INDEX ix_food_logs_encounter ON food_logs (encounter_id);
CREATE INDEX ix_otc_medication_logs_encounter ON otc_medication_logs (encounter_id);
CREATE INDEX ix_referrals_patient_time ON referrals (patient_id, created_at DESC);
CREATE INDEX ix_referrals_status_due_date ON referrals (status, due_date);
CREATE INDEX ix_referral_status_history_time
  ON referral_status_history (referral_id, changed_at);
CREATE INDEX ix_followups_referral_contact_date
  ON followups (referral_id, contact_date DESC);
CREATE INDEX ix_sync_outbox_status_next_attempt
  ON sync_outbox (status, next_attempt_at, created_at);
CREATE INDEX ix_sync_attempts_started_at ON sync_attempts (started_at DESC);
CREATE INDEX ix_audit_log_occurred_at ON audit_log (occurred_at DESC);
CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id, occurred_at DESC);
