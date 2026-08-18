ALTER TABLE lifestyle_other_activity_rows RENAME TO lifestyle_other_activity_rows_legacy;

CREATE TABLE lifestyle_other_activity_rows (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  category TEXT NOT NULL CHECK (
    category IN ('FARMING_GARDENING', 'HOUSEHOLD', 'CAREGIVING', 'COMMUNITY', 'COMMUTE', 'SPORT', 'OTHER')
  ),
  description TEXT NULL,
  days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7),
  average_minutes_per_day INTEGER NOT NULL CHECK (average_minutes_per_day > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_other_activity_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank
    CHECK (description IS NULL OR TRIM(description) != ''),
  CONSTRAINT fk_lifestyle_other_activity_rows_parent FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_other_activity_rows_sequence UNIQUE (lifestyle_draft_id, sequence_number)
) STRICT;

INSERT INTO lifestyle_other_activity_rows (
  id,
  lifestyle_draft_id,
  sequence_number,
  category,
  description,
  days_in_past_seven_days,
  average_minutes_per_day,
  intensity,
  created_by,
  created_at,
  updated_by,
  updated_at
)
SELECT
  id,
  lifestyle_draft_id,
  sequence_number,
  category,
  description,
  days_in_past_seven_days,
  average_minutes_per_day,
  intensity,
  created_by,
  created_at,
  updated_by,
  updated_at
FROM lifestyle_other_activity_rows_legacy;

DROP TABLE lifestyle_other_activity_rows_legacy;

CREATE INDEX ix_lifestyle_other_activity_rows_draft
  ON lifestyle_other_activity_rows (lifestyle_draft_id);
