-- Downloaded records are a replaceable read-only cache, never local clinical records.
CREATE TABLE central_history_snapshots (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  binding_key TEXT NOT NULL CHECK (length(binding_key) = 64),
  state TEXT NOT NULL CHECK (state IN ('DOWNLOADING', 'READY')),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'CARE_DELIVERY', 'CARE_COORDINATION', 'PATIENT_REQUEST',
    'QUALITY_IMPROVEMENT', 'OPERATIONS_SUPPORT'
  )),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL CHECK (to_date >= from_date),
  retrieved_at TEXT,
  patient_json TEXT CHECK (patient_json IS NULL OR json_valid(patient_json)),
  next_cursor TEXT,
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count BETWEEN 0 AND 200),
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count BETWEEN 0 AND 5000),
  byte_count INTEGER NOT NULL DEFAULT 0 CHECK (byte_count BETWEEN 0 AND 16777216),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (patient_id, owner_user_id, state),
  CHECK (state != 'READY' OR (retrieved_at IS NOT NULL AND patient_json IS NOT NULL AND next_cursor IS NULL))
) STRICT;

CREATE TABLE central_history_items (
  snapshot_id TEXT NOT NULL REFERENCES central_history_snapshots(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 4999),
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'SCREENING_ENCOUNTER', 'VITALS', 'LIFESTYLE', 'FOOD', 'OTC', 'REFERRAL',
    'REFERRAL_STATUS', 'REFERRAL_FOLLOWUP', 'ENCOUNTER_ADDENDUM',
    'ENCOUNTER_REVIEW_FLAG', 'ENCOUNTER_REVIEW_STATUS'
  )),
  resource_id TEXT NOT NULL,
  item_json TEXT NOT NULL CHECK (json_valid(item_json)),
  PRIMARY KEY (snapshot_id, resource_type, resource_id),
  UNIQUE (snapshot_id, position)
) STRICT;

CREATE INDEX ix_central_history_expiry ON central_history_snapshots(updated_at);
