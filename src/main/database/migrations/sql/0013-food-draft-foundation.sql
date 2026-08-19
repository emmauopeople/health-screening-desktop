CREATE TABLE food_catalog_items (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (TRIM(display_name) != '' AND length(display_name) <= 100),
  normalized_search_name TEXT NOT NULL COLLATE NOCASE CHECK (
    TRIM(normalized_search_name) != ''
    AND length(normalized_search_name) <= 100
  ),
  is_active INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (sort_order > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_food_catalog_items_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT ux_food_catalog_items_normalized_search_name UNIQUE (normalized_search_name),
  CONSTRAINT ux_food_catalog_items_sort_order UNIQUE (sort_order)
) STRICT;

CREATE TABLE food_drafts (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL,
  screening_session_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  food_response TEXT NULL CHECK (
    food_response IN ('REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER')
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_food_drafts_period_dates CHECK (period_start <= period_end),
  CONSTRAINT ck_food_drafts_period_start_date CHECK (
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
  CONSTRAINT ck_food_drafts_period_end_date CHECK (
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
  CONSTRAINT ck_food_drafts_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_food_drafts_encounter_ownership
    FOREIGN KEY (encounter_id, patient_id, screening_session_id, location_id)
    REFERENCES screening_encounters (id, patient_id, screening_session_id, location_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_screening_session FOREIGN KEY (screening_session_id)
    REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_installation FOREIGN KEY (installation_id)
    REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_drafts_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE food_draft_rows (
  id TEXT PRIMARY KEY,
  food_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  catalog_code TEXT NULL,
  food_name_snapshot TEXT NOT NULL CHECK (
    TRIM(food_name_snapshot) != ''
    AND length(food_name_snapshot) <= 100
  ),
  food_name_normalized TEXT NOT NULL COLLATE NOCASE CHECK (
    TRIM(food_name_normalized) != ''
    AND length(food_name_normalized) <= 100
  ),
  frequency_code TEXT NULL CHECK (
    frequency_code IS NULL OR frequency_code IN ('1_DAY', '2_TO_3_DAYS', '4_TO_6_DAYS', 'EVERY_DAY')
  ),
  preparation_note TEXT NULL CHECK (
    preparation_note IS NULL OR (
      TRIM(preparation_note) != ''
      AND length(preparation_note) <= 200
    )
  ),
  source_type TEXT NOT NULL CHECK (source_type = 'PATIENT_REPORTED'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_food_draft_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_food_draft_rows_parent FOREIGN KEY (food_draft_id)
    REFERENCES food_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_draft_rows_catalog FOREIGN KEY (catalog_code)
    REFERENCES food_catalog_items (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_draft_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_food_draft_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_food_draft_rows_sequence UNIQUE (food_draft_id, sequence_number),
  CONSTRAINT ux_food_draft_rows_normalized_name UNIQUE (food_draft_id, food_name_normalized)
) STRICT;

CREATE INDEX ix_food_catalog_items_active_order
  ON food_catalog_items (is_active, sort_order, code);

CREATE INDEX ix_food_drafts_encounter
  ON food_drafts (encounter_id);

CREATE INDEX ix_food_drafts_patient
  ON food_drafts (patient_id);

CREATE INDEX ix_food_draft_rows_draft
  ON food_draft_rows (food_draft_id);

CREATE INDEX ix_food_draft_rows_catalog
  ON food_draft_rows (catalog_code);

INSERT INTO food_catalog_items (
  code,
  display_name,
  normalized_search_name,
  is_active,
  sort_order,
  created_at,
  updated_at
) VALUES
  ('RICE', 'Rice', 'rice', 1, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('BEANS', 'Beans', 'beans', 1, 2, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('CORN_FUFU', 'Corn fufu', 'corn fufu', 1, 3, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('WATER_FUFU', 'Water fufu', 'water fufu', 1, 4, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('GARRI', 'Garri', 'garri', 1, 5, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('PLANTAIN', 'Plantain', 'plantain', 1, 6, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('YAM', 'Yam', 'yam', 1, 7, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('COCOYAM', 'Cocoyam', 'cocoyam', 1, 8, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('IRISH_POTATO', 'Irish potato', 'irish potato', 1, 9, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('SWEET_POTATO', 'Sweet potato', 'sweet potato', 1, 10, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('CASSAVA', 'Cassava', 'cassava', 1, 11, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('LEAFY_VEGETABLES', 'Leafy vegetables', 'leafy vegetables', 1, 12, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('OTHER_VEGETABLES', 'Other vegetables', 'other vegetables', 1, 13, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('FRUIT', 'Fruit', 'fruit', 1, 14, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('FISH', 'Fish', 'fish', 1, 15, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('CHICKEN', 'Chicken', 'chicken', 1, 16, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('BEEF', 'Beef', 'beef', 1, 17, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('PORK', 'Pork', 'pork', 1, 18, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('EGGS', 'Eggs', 'eggs', 1, 19, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('BREAD', 'Bread', 'bread', 1, 20, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('GROUNDNUTS', 'Groundnuts', 'groundnuts', 1, 21, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('MILK_DAIRY', 'Milk or dairy', 'milk or dairy', 1, 22, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('FRIED_FOODS', 'Fried foods', 'fried foods', 1, 23, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('PROCESSED_MEATS', 'Processed meats', 'processed meats', 1, 24, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('INSTANT_NOODLES', 'Instant noodles', 'instant noodles', 1, 25, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('SUGARY_DRINKS', 'Sugary drinks', 'sugary drinks', 1, 26, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
