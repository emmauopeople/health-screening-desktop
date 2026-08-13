CREATE TABLE lifestyle_alcohol_baseline_versions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('CURRENT', 'FORMER', 'NEVER', 'UNKNOWN', 'DECLINED')
  ),
  ever_consumed TEXT NOT NULL CHECK (
    ever_consumed IN ('YES', 'NO', 'UNKNOWN', 'DECLINED')
  ),
  consumed_past_12_months TEXT NOT NULL CHECK (
    consumed_past_12_months IN ('YES', 'NO', 'UNKNOWN', 'DECLINED')
  ),
  common_beverage_types_json TEXT NULL CHECK (
    common_beverage_types_json IS NULL OR json_valid(common_beverage_types_json) = 1
  ),
  other_beverage_description TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_alcohol_baseline_versions_updated_at
    CHECK (updated_at >= created_at),
  CONSTRAINT ck_lifestyle_alcohol_baseline_versions_other_beverage_required
    CHECK (
      common_beverage_types_json IS NULL
      OR common_beverage_types_json NOT LIKE '%"OTHER"%'
      OR (
        other_beverage_description IS NOT NULL
        AND TRIM(other_beverage_description) != ''
      )
    ),
  CONSTRAINT ck_lifestyle_alcohol_baseline_versions_other_beverage_absent
    CHECK (
      other_beverage_description IS NULL
      OR (
        common_beverage_types_json IS NOT NULL
        AND common_beverage_types_json LIKE '%"OTHER"%'
      )
    ),
  CONSTRAINT fk_lifestyle_alcohol_baseline_versions_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_alcohol_baseline_versions_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_alcohol_baseline_versions_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_alcohol_baseline_versions_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_tobacco_baseline_versions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('CURRENT_DAILY', 'CURRENT_SOME_DAYS', 'FORMER', 'NEVER', 'UNKNOWN', 'DECLINED')
  ),
  ever_regularly_used TEXT NOT NULL CHECK (
    ever_regularly_used IN ('YES', 'NO', 'UNKNOWN', 'DECLINED')
  ),
  former_use_approximate_stop_date TEXT NULL,
  current_use_frequency TEXT NOT NULL CHECK (
    current_use_frequency IN ('EVERY_DAY', 'SOME_DAYS', 'NOT_AT_ALL', 'UNKNOWN', 'DECLINED')
  ),
  product_types_json TEXT NULL CHECK (
    product_types_json IS NULL OR json_valid(product_types_json) = 1
  ),
  other_product_description TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_tobacco_baseline_versions_updated_at
    CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_tobacco_baseline_versions_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_baseline_versions_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_baseline_versions_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_baseline_versions_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_work_baseline_versions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (
    status IN (
      'EMPLOYED',
      'SELF_EMPLOYED',
      'FARMING',
      'STUDENT',
      'HOMEMAKER_CAREGIVER',
      'UNEMPLOYED',
      'RETIRED',
      'UNABLE_TO_WORK',
      'OTHER',
      'DECLINED'
    )
  ),
  occupation_job_title TEXT NULL,
  usual_physical_demand TEXT NULL CHECK (
    usual_physical_demand IN ('SITTING', 'STANDING', 'WALKING', 'MODERATE_LABOR', 'HEAVY_LABOR', 'VARIES')
    OR usual_physical_demand IS NULL
  ),
  typical_workdays_per_week INTEGER NULL CHECK (
    typical_workdays_per_week IS NULL OR (
      typical_workdays_per_week >= 0 AND typical_workdays_per_week <= 7
    )
  ),
  typical_hours_per_workday REAL NULL CHECK (
    typical_hours_per_workday IS NULL OR (
      typical_hours_per_workday > 0 AND typical_hours_per_workday <= 24
    )
  ),
  shift_pattern TEXT NULL CHECK (
    shift_pattern IN (
      'DAY',
      'EVENING',
      'NIGHT',
      'ROTATING',
      'IRREGULAR',
      'NOT_APPLICABLE',
      'UNKNOWN',
      'DECLINED'
    )
    OR shift_pattern IS NULL
  ),
  description TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_work_baseline_versions_updated_at
    CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_work_baseline_versions_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_work_baseline_versions_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_work_baseline_versions_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_work_baseline_versions_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_drafts (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETE')),
  patient_id TEXT NOT NULL,
  screening_session_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  alcohol_baseline_version_id TEXT NULL,
  tobacco_baseline_version_id TEXT NULL,
  work_baseline_version_id TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_lifestyle_drafts_period_dates CHECK (period_start <= period_end),
  CONSTRAINT ck_lifestyle_drafts_period_start_date CHECK (
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
  CONSTRAINT ck_lifestyle_drafts_period_end_date CHECK (
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
  CONSTRAINT ck_lifestyle_drafts_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_drafts_encounter_ownership
    FOREIGN KEY (encounter_id, patient_id, screening_session_id, location_id)
    REFERENCES screening_encounters (id, patient_id, screening_session_id, location_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_screening_session FOREIGN KEY (screening_session_id)
    REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_alcohol_baseline
    FOREIGN KEY (alcohol_baseline_version_id, patient_id, installation_id)
    REFERENCES lifestyle_alcohol_baseline_versions (id, patient_id, installation_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_tobacco_baseline
    FOREIGN KEY (tobacco_baseline_version_id, patient_id, installation_id)
    REFERENCES lifestyle_tobacco_baseline_versions (id, patient_id, installation_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_work_baseline
    FOREIGN KEY (work_baseline_version_id, patient_id, installation_id)
    REFERENCES lifestyle_work_baseline_versions (id, patient_id, installation_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_drafts_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_alcohol_weekly_records (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL UNIQUE,
  weekly_response TEXT NULL CHECK (
    weekly_response IN ('YES', 'NO', 'UNKNOWN', 'DECLINED', 'NOT_APPLICABLE', 'PREFER_NOT_TO_ANSWER')
  ),
  drinking_days INTEGER NULL CHECK (drinking_days IS NULL OR drinking_days BETWEEN 0 AND 7),
  total_standardized_drinks REAL NULL CHECK (total_standardized_drinks IS NULL OR total_standardized_drinks >= 0),
  largest_one_day_amount REAL NULL CHECK (largest_one_day_amount IS NULL OR largest_one_day_amount >= 0),
  days_at_largest_amount INTEGER NULL CHECK (
    days_at_largest_amount IS NULL OR (days_at_largest_amount BETWEEN 0 AND 7)
  ),
  common_beverage_types_json TEXT NULL CHECK (
    common_beverage_types_json IS NULL OR json_valid(common_beverage_types_json) = 1
  ),
  other_beverage_description TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_json CHECK (
    common_beverage_types_json IS NULL OR json_valid(common_beverage_types_json) = 1
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_no_branch CHECK (
    weekly_response != 'NO'
    OR (
      drinking_days IS NULL
      AND total_standardized_drinks IS NULL
      AND largest_one_day_amount IS NULL
      AND days_at_largest_amount IS NULL
      AND COALESCE(json_array_length(common_beverage_types_json), 0) = 0
      AND other_beverage_description IS NULL
    )
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_yes_branch CHECK (
    weekly_response != 'YES'
    OR (
      (drinking_days IS NULL OR drinking_days BETWEEN 1 AND 7)
      AND (total_standardized_drinks IS NULL OR total_standardized_drinks > 0)
      AND (largest_one_day_amount IS NULL OR largest_one_day_amount > 0)
      AND (days_at_largest_amount IS NULL OR days_at_largest_amount BETWEEN 1 AND 7)
    )
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_unknown_branch CHECK (
    weekly_response IN ('YES', 'NO')
    OR (
      drinking_days IS NULL
      AND total_standardized_drinks IS NULL
      AND largest_one_day_amount IS NULL
      AND days_at_largest_amount IS NULL
      AND COALESCE(json_array_length(common_beverage_types_json), 0) = 0
      AND other_beverage_description IS NULL
    )
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_largest_amount CHECK (
    largest_one_day_amount IS NULL
    OR total_standardized_drinks IS NULL
    OR largest_one_day_amount <= total_standardized_drinks
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_largest_days CHECK (
    days_at_largest_amount IS NULL
    OR drinking_days IS NULL
    OR days_at_largest_amount <= drinking_days
  ),
  CONSTRAINT ck_lifestyle_alcohol_weekly_records_other_beverage_absent CHECK (
    other_beverage_description IS NULL
    OR (
      common_beverage_types_json IS NOT NULL
      AND common_beverage_types_json LIKE '%"OTHER"%'
    )
  ),
  CONSTRAINT fk_lifestyle_alcohol_weekly_records_draft FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_alcohol_weekly_records_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_alcohol_weekly_records_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_tobacco_weekly_records (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL UNIQUE,
  weekly_response TEXT NULL CHECK (
    weekly_response IN ('YES', 'NO', 'UNKNOWN', 'DECLINED', 'NOT_APPLICABLE', 'PREFER_NOT_TO_ANSWER')
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_tobacco_weekly_records_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_tobacco_weekly_records_draft FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_weekly_records_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_weekly_records_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_tobacco_product_rows (
  id TEXT PRIMARY KEY,
  tobacco_weekly_record_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  product_type TEXT NOT NULL CHECK (
    product_type IN ('CIGARETTE', 'ROLLED_TOBACCO', 'CIGAR_PIPE', 'SMOKELESS', 'SNUFF', 'HOOKAH', 'VAPE', 'OTHER')
  ),
  days_used INTEGER NOT NULL CHECK (days_used BETWEEN 1 AND 7),
  average_quantity_per_use_day REAL NOT NULL CHECK (average_quantity_per_use_day > 0),
  unit TEXT NOT NULL CHECK (
    unit IN ('STICKS_CIGARETTES', 'SESSIONS', 'PORTIONS', 'PINS', 'PODS_CARTRIDGES', 'OTHER')
  ),
  secondhand_smoke_exposure INTEGER NULL CHECK (
    secondhand_smoke_exposure IS NULL OR secondhand_smoke_exposure IN (0, 1)
  ),
  other_product_description TEXT NULL,
  other_unit_description TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_tobacco_product_rows_other_product_required
    CHECK (
      product_type != 'OTHER' OR (other_product_description IS NOT NULL AND TRIM(other_product_description) != '')
    ),
  CONSTRAINT ck_lifestyle_tobacco_product_rows_other_unit_required
    CHECK (
      unit != 'OTHER' OR (other_unit_description IS NOT NULL AND TRIM(other_unit_description) != '')
    ),
  CONSTRAINT ck_lifestyle_tobacco_product_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_tobacco_product_rows_parent FOREIGN KEY (tobacco_weekly_record_id)
    REFERENCES lifestyle_tobacco_weekly_records (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_product_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_tobacco_product_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_tobacco_product_rows_sequence
    UNIQUE (tobacco_weekly_record_id, sequence_number)
) STRICT;

CREATE TABLE lifestyle_physical_activity_weekly_records (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL UNIQUE,
  weekly_response TEXT NULL CHECK (
    weekly_response IN (
      'YES',
      'NO',
      'UNKNOWN',
      'DECLINED',
      'NOT_APPLICABLE',
      'UNABLE_TO_ANSWER',
      'PREFER_NOT_TO_ANSWER'
    )
  ),
  sedentary_minutes_per_day INTEGER NULL CHECK (
    sedentary_minutes_per_day IS NULL OR (sedentary_minutes_per_day BETWEEN 0 AND 1439)
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_physical_activity_weekly_records_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_physical_activity_weekly_records_draft FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_physical_activity_weekly_records_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_physical_activity_weekly_records_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_activity_rows (
  id TEXT PRIMARY KEY,
  physical_activity_weekly_record_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  activity_domain TEXT NOT NULL CHECK (
    activity_domain IN ('WORK_OR_FARMING', 'TRANSPORT', 'HOUSEHOLD', 'EXERCISE')
  ),
  description TEXT NULL,
  intensity TEXT NOT NULL CHECK (
    intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS')
  ),
  days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7),
  average_minutes_per_active_day INTEGER NOT NULL CHECK (average_minutes_per_active_day > 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_activity_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_activity_rows_parent FOREIGN KEY (physical_activity_weekly_record_id)
    REFERENCES lifestyle_physical_activity_weekly_records (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_activity_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_activity_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_activity_rows_sequence
    UNIQUE (physical_activity_weekly_record_id, sequence_number)
) STRICT;

CREATE TABLE lifestyle_work_weekly_records (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL UNIQUE,
  weekly_response TEXT NULL CHECK (
    weekly_response IN (
      'USUAL',
      'LESS_THAN_USUAL',
      'MORE_THAN_USUAL',
      'NO_WORK',
      'NOT_APPLICABLE',
      'UNKNOWN',
      'DECLINED',
      'PREFER_NOT_TO_ANSWER'
    )
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_work_weekly_records_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_work_weekly_records_draft FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_work_weekly_records_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_work_weekly_records_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE lifestyle_other_activity_rows (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  category TEXT NOT NULL CHECK (
    category IN ('FARMING_GARDENING', 'HOUSEHOLD', 'CAREGIVING', 'COMMUNITY', 'COMMUTE', 'SPORT', 'OTHER')
  ),
  description TEXT NOT NULL,
  days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7),
  average_minutes_per_day INTEGER NOT NULL CHECK (average_minutes_per_day > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_other_activity_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank CHECK (TRIM(description) != ''),
  CONSTRAINT fk_lifestyle_other_activity_rows_parent FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_other_activity_rows_sequence
    UNIQUE (lifestyle_draft_id, sequence_number)
) STRICT;

CREATE UNIQUE INDEX ux_screening_encounters_lifestyle_draft_ownership
  ON screening_encounters (id, patient_id, screening_session_id, location_id);

CREATE INDEX ix_lifestyle_alcohol_baseline_versions_patient_installation
  ON lifestyle_alcohol_baseline_versions (patient_id, installation_id);

CREATE UNIQUE INDEX ux_lifestyle_alcohol_baseline_versions_version
  ON lifestyle_alcohol_baseline_versions (patient_id, installation_id, version);

CREATE UNIQUE INDEX ux_lifestyle_alcohol_baseline_versions_reference
  ON lifestyle_alcohol_baseline_versions (id, patient_id, installation_id);

CREATE INDEX ix_lifestyle_tobacco_baseline_versions_patient_installation
  ON lifestyle_tobacco_baseline_versions (patient_id, installation_id);

CREATE UNIQUE INDEX ux_lifestyle_tobacco_baseline_versions_version
  ON lifestyle_tobacco_baseline_versions (patient_id, installation_id, version);

CREATE UNIQUE INDEX ux_lifestyle_tobacco_baseline_versions_reference
  ON lifestyle_tobacco_baseline_versions (id, patient_id, installation_id);

CREATE INDEX ix_lifestyle_work_baseline_versions_patient_installation
  ON lifestyle_work_baseline_versions (patient_id, installation_id);

CREATE UNIQUE INDEX ux_lifestyle_work_baseline_versions_version
  ON lifestyle_work_baseline_versions (patient_id, installation_id, version);

CREATE UNIQUE INDEX ux_lifestyle_work_baseline_versions_reference
  ON lifestyle_work_baseline_versions (id, patient_id, installation_id);

CREATE INDEX ix_lifestyle_drafts_encounter
  ON lifestyle_drafts (encounter_id);

CREATE INDEX ix_lifestyle_drafts_patient
  ON lifestyle_drafts (patient_id);

CREATE INDEX ix_lifestyle_alcohol_weekly_records_draft
  ON lifestyle_alcohol_weekly_records (lifestyle_draft_id);

CREATE INDEX ix_lifestyle_tobacco_weekly_records_draft
  ON lifestyle_tobacco_weekly_records (lifestyle_draft_id);

CREATE INDEX ix_lifestyle_tobacco_product_rows_draft
  ON lifestyle_tobacco_product_rows (tobacco_weekly_record_id);

CREATE INDEX ix_lifestyle_physical_activity_weekly_records_draft
  ON lifestyle_physical_activity_weekly_records (lifestyle_draft_id);

CREATE INDEX ix_lifestyle_activity_rows_record
  ON lifestyle_activity_rows (physical_activity_weekly_record_id);

CREATE INDEX ix_lifestyle_work_weekly_records_draft
  ON lifestyle_work_weekly_records (lifestyle_draft_id);

CREATE INDEX ix_lifestyle_other_activity_rows_draft
  ON lifestyle_other_activity_rows (lifestyle_draft_id);
