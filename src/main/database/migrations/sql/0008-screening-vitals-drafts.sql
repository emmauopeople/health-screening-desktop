CREATE TABLE screening_vitals_drafts (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'VITALS_COMPLETE')),
  weight_kg REAL NULL CHECK (weight_kg IS NULL OR weight_kg > 0),
  waist_cm REAL NULL CHECK (waist_cm IS NULL OR waist_cm > 0),
  notes TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_screening_vitals_drafts_updated_at
    CHECK (updated_at >= created_at),
  CONSTRAINT fk_screening_vitals_drafts_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_vitals_drafts_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_vitals_drafts_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE screening_vitals_draft_readings (
  id TEXT PRIMARY KEY,
  vitals_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  systolic INTEGER NULL CHECK (systolic IS NULL OR systolic > 0),
  diastolic INTEGER NULL CHECK (diastolic IS NULL OR diastolic > 0),
  pulse INTEGER NULL CHECK (pulse IS NULL OR pulse > 0),
  measurement_site TEXT NULL CHECK (
    measurement_site IS NULL OR
    measurement_site IN ('RIGHT_ARM', 'LEFT_ARM', 'LEFT_LEG', 'RIGHT_LEG')
  ),
  patient_position TEXT NULL CHECK (
    patient_position IS NULL OR
    patient_position IN ('LYING', 'STANDING', 'SITTING')
  ),
  measurement_time TEXT NULL CHECK (
    measurement_time IS NULL OR
    measurement_time GLOB '[0-2][0-9]:[0-5][0-9]'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_screening_vitals_draft_readings_updated_at
    CHECK (updated_at >= created_at),
  CONSTRAINT ck_screening_vitals_draft_readings_time_hour
    CHECK (
      measurement_time IS NULL OR
      CAST(substr(measurement_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    ),
  CONSTRAINT fk_screening_vitals_draft_readings_draft FOREIGN KEY (vitals_draft_id)
    REFERENCES screening_vitals_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_screening_vitals_drafts_encounter
  ON screening_vitals_drafts (encounter_id);

CREATE UNIQUE INDEX ux_screening_vitals_draft_readings_sequence
  ON screening_vitals_draft_readings (vitals_draft_id, sequence_number);

CREATE INDEX ix_screening_vitals_draft_readings_draft
  ON screening_vitals_draft_readings (vitals_draft_id);
