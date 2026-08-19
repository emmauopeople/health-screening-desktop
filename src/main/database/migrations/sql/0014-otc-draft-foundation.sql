CREATE TABLE otc_drafts (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL,
  screening_session_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  otc_response TEXT NULL CHECK (
    otc_response IN ('REPORTED', 'NONE_REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER')
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_otc_drafts_period_dates CHECK (period_start <= period_end),
  CONSTRAINT ck_otc_drafts_period_start_date CHECK (
    length(period_start) = 10
    AND period_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND CAST(substr(period_start, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(period_start, 9, 2) AS INTEGER) BETWEEN 1 AND
      CASE
        WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
        WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
        WHEN (
          CAST(substr(period_start, 1, 4) AS INTEGER) % 400 = 0
          OR (
            CAST(substr(period_start, 1, 4) AS INTEGER) % 4 = 0
            AND CAST(substr(period_start, 1, 4) AS INTEGER) % 100 != 0
          )
        ) THEN 29
        ELSE 28
      END
  ),
  CONSTRAINT ck_otc_drafts_period_end_date CHECK (
    length(period_end) = 10
    AND period_end GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND CAST(substr(period_end, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(period_end, 9, 2) AS INTEGER) BETWEEN 1 AND
      CASE
        WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
        WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
        WHEN (
          CAST(substr(period_end, 1, 4) AS INTEGER) % 400 = 0
          OR (
            CAST(substr(period_end, 1, 4) AS INTEGER) % 4 = 0
            AND CAST(substr(period_end, 1, 4) AS INTEGER) % 100 != 0
          )
        ) THEN 29
        ELSE 28
      END
  ),
  CONSTRAINT ck_otc_drafts_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_otc_drafts_encounter_ownership
    FOREIGN KEY (encounter_id, patient_id, screening_session_id, location_id)
    REFERENCES screening_encounters (id, patient_id, screening_session_id, location_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_screening_session FOREIGN KEY (screening_session_id)
    REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_drafts_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE otc_draft_rows (
  id TEXT PRIMARY KEY,
  otc_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  product_name_snapshot TEXT NULL CHECK (
    product_name_snapshot IS NULL OR (
      TRIM(product_name_snapshot) != ''
      AND length(product_name_snapshot) <= 160
    )
  ),
  product_name_normalized TEXT NULL COLLATE NOCASE CHECK (
    product_name_normalized IS NULL OR (
      TRIM(product_name_normalized) != ''
      AND length(product_name_normalized) <= 160
    )
  ),
  reason_for_use TEXT NULL CHECK (
    reason_for_use IS NULL OR (
      TRIM(reason_for_use) != ''
      AND length(reason_for_use) <= 500
    )
  ),
  dose_text TEXT NULL CHECK (
    dose_text IS NULL OR (
      TRIM(dose_text) != ''
      AND length(dose_text) <= 160
    )
  ),
  frequency_text TEXT NULL CHECK (
    frequency_text IS NULL OR (
      TRIM(frequency_text) != ''
      AND length(frequency_text) <= 160
    )
  ),
  duration_text TEXT NULL CHECK (
    duration_text IS NULL OR (
      TRIM(duration_text) != ''
      AND length(duration_text) <= 160
    )
  ),
  source_of_medication TEXT NULL CHECK (
    source_of_medication IS NULL OR (
      TRIM(source_of_medication) != ''
      AND length(source_of_medication) <= 160
    )
  ),
  currently_taking_response TEXT NULL CHECK (
    currently_taking_response IS NULL OR currently_taking_response IN ('YES', 'NO', 'UNKNOWN')
  ),
  source_type TEXT NOT NULL CHECK (source_type = 'PATIENT_REPORTED'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_otc_draft_rows_has_meaningful_value CHECK (
    product_name_snapshot IS NOT NULL
    OR reason_for_use IS NOT NULL
    OR dose_text IS NOT NULL
    OR frequency_text IS NOT NULL
    OR duration_text IS NOT NULL
    OR source_of_medication IS NOT NULL
    OR currently_taking_response IS NOT NULL
  ),
  CONSTRAINT ck_otc_draft_rows_name_pair CHECK (
    (product_name_snapshot IS NULL AND product_name_normalized IS NULL)
    OR (product_name_snapshot IS NOT NULL AND product_name_normalized IS NOT NULL)
  ),
  CONSTRAINT ck_otc_draft_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_otc_draft_rows_parent FOREIGN KEY (otc_draft_id)
    REFERENCES otc_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_draft_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_otc_draft_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_otc_draft_rows_sequence UNIQUE (otc_draft_id, sequence_number)
) STRICT;

CREATE INDEX ix_otc_drafts_encounter
  ON otc_drafts (encounter_id);

CREATE INDEX ix_otc_drafts_patient
  ON otc_drafts (patient_id);

CREATE INDEX ix_otc_draft_rows_draft
  ON otc_draft_rows (otc_draft_id);
