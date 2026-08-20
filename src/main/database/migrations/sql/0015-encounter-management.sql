CREATE TABLE screening_encounter_addenda (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  note_text TEXT NOT NULL CHECK (
    TRIM(note_text) != ''
    AND length(note_text) <= 2000
  ),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT fk_screening_encounter_addenda_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounter_addenda_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE screening_encounter_review_flags (
  id TEXT PRIMARY KEY,
  encounter_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'POSSIBLE_DATA_ERROR',
      'MISSING_INFORMATION',
      'WRONG_PATIENT',
      'DUPLICATE_ENCOUNTER',
      'OTHER'
    )
  ),
  description TEXT NOT NULL CHECK (
    TRIM(description) != ''
    AND length(description) <= 1000
  ),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  resolved_by TEXT NULL,
  resolved_at TEXT NULL,
  resolution_note TEXT NULL CHECK (
    resolution_note IS NULL OR (
      TRIM(resolution_note) != ''
      AND length(resolution_note) <= 1000
    )
  ),
  CONSTRAINT ck_screening_encounter_review_flags_resolution CHECK (
    (
      status = 'OPEN'
      AND resolved_by IS NULL
      AND resolved_at IS NULL
      AND resolution_note IS NULL
    )
    OR (
      status IN ('RESOLVED', 'DISMISSED')
      AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL
      AND resolution_note IS NOT NULL
      AND resolved_at >= opened_at
    )
  ),
  CONSTRAINT fk_screening_encounter_review_flags_encounter FOREIGN KEY (encounter_id)
    REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounter_review_flags_opened_by FOREIGN KEY (opened_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_encounter_review_flags_resolved_by FOREIGN KEY (resolved_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_screening_encounter_addenda_encounter
  ON screening_encounter_addenda (encounter_id, created_at DESC);

CREATE INDEX ix_screening_encounter_review_flags_encounter
  ON screening_encounter_review_flags (encounter_id, opened_at DESC);

CREATE INDEX ix_screening_encounter_review_flags_status
  ON screening_encounter_review_flags (status, opened_at DESC);
