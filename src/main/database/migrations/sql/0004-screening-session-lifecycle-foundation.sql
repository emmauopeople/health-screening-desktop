CREATE TEMP TABLE hsd027_screening_session_migration_guard (
  value INTEGER NOT NULL CONSTRAINT ck_hsd027_screening_session_migration_guard CHECK (value = 0)
) STRICT;

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions
  WHERE status NOT IN ('OPEN', 'CLOSED')
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions
  WHERE status = 'CLOSED'
    AND (closed_by IS NULL OR closed_at IS NULL)
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions
  WHERE status = 'OPEN'
    AND (closed_by IS NOT NULL OR closed_at IS NOT NULL)
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions AS session
  LEFT JOIN locations AS location
    ON location.id = session.location_id
  WHERE location.id IS NULL
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions AS session
  LEFT JOIN protocol_versions AS protocol_version
    ON protocol_version.id = session.protocol_version_id
  WHERE protocol_version.id IS NULL
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions AS session
  LEFT JOIN users AS created_user
    ON created_user.id = session.created_by
  WHERE created_user.id IS NULL
);

INSERT INTO hsd027_screening_session_migration_guard (value)
SELECT 1
WHERE EXISTS (
  SELECT 1
  FROM screening_sessions AS session
  LEFT JOIN users AS closed_user
    ON closed_user.id = session.closed_by
  WHERE session.closed_by IS NOT NULL
    AND closed_user.id IS NULL
);

DROP TABLE hsd027_screening_session_migration_guard;

CREATE TABLE screening_sessions_v4 (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  protocol_version_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  notes TEXT NULL CHECK (notes IS NULL OR length(notes) <= 500),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_by TEXT NULL,
  closed_at TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_version INTEGER NOT NULL CHECK (row_version >= 1),
  CONSTRAINT ck_screening_sessions_current_status_state
    CHECK (
      (
        status = 'OPEN'
        AND closed_by IS NULL
        AND closed_at IS NULL
      )
      OR (
        status = 'CLOSED'
        AND closed_by IS NOT NULL
        AND closed_at IS NOT NULL
      )
    ),
  CONSTRAINT fk_screening_sessions_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_protocol_version FOREIGN KEY (protocol_version_id)
    REFERENCES protocol_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_opened_by FOREIGN KEY (opened_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_closed_by FOREIGN KEY (closed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_sessions_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

INSERT INTO screening_sessions_v4 (
  id,
  location_id,
  protocol_version_id,
  session_date,
  status,
  notes,
  opened_by,
  opened_at,
  closed_by,
  closed_at,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
)
SELECT
  id,
  location_id,
  protocol_version_id,
  session_date,
  status,
  NULL,
  created_by,
  opened_at,
  CASE status WHEN 'CLOSED' THEN closed_by ELSE NULL END,
  CASE status WHEN 'CLOSED' THEN closed_at ELSE NULL END,
  created_by,
  created_at,
  CASE status WHEN 'CLOSED' THEN closed_by ELSE created_by END,
  updated_at,
  CASE status WHEN 'CLOSED' THEN 2 ELSE 1 END
FROM screening_sessions;

DROP TABLE screening_sessions;

ALTER TABLE screening_sessions_v4 RENAME TO screening_sessions;

CREATE TABLE screening_session_lifecycle_history (
  id TEXT PRIMARY KEY,
  screening_session_id TEXT NOT NULL,
  transition_type TEXT NOT NULL CHECK (
    transition_type IN ('CREATED', 'CLOSED', 'REOPENED')
  ),
  from_status TEXT NULL CHECK (
    from_status IS NULL OR from_status IN ('OPEN', 'CLOSED')
  ),
  to_status TEXT NOT NULL CHECK (to_status IN ('OPEN', 'CLOSED')),
  reason TEXT NULL CHECK (reason IS NULL OR length(reason) <= 500),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  prior_row_version INTEGER NULL CHECK (
    prior_row_version IS NULL OR prior_row_version >= 1
  ),
  resulting_row_version INTEGER NOT NULL CHECK (resulting_row_version >= 1),
  CONSTRAINT ck_screening_session_lifecycle_history_transition
    CHECK (
      (
        transition_type = 'CREATED'
        AND from_status IS NULL
        AND to_status = 'OPEN'
        AND reason IS NULL
        AND prior_row_version IS NULL
        AND resulting_row_version = 1
      )
      OR (
        transition_type = 'CLOSED'
        AND from_status = 'OPEN'
        AND to_status = 'CLOSED'
        AND prior_row_version >= 1
        AND resulting_row_version = prior_row_version + 1
      )
      OR (
        transition_type = 'REOPENED'
        AND from_status = 'CLOSED'
        AND to_status = 'OPEN'
        AND reason IS NOT NULL
        AND length(trim(reason)) > 0
        AND prior_row_version >= 1
        AND resulting_row_version = prior_row_version + 1
      )
    ),
  CONSTRAINT fk_screening_session_lifecycle_history_session FOREIGN KEY (screening_session_id)
    REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_screening_session_lifecycle_history_changed_by FOREIGN KEY (changed_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

INSERT INTO screening_session_lifecycle_history (
  id,
  screening_session_id,
  transition_type,
  from_status,
  to_status,
  reason,
  changed_by,
  changed_at,
  prior_row_version,
  resulting_row_version
)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + abs(random() % 4), 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  id,
  'CREATED',
  NULL,
  'OPEN',
  NULL,
  created_by,
  opened_at,
  NULL,
  1
FROM screening_sessions;

INSERT INTO screening_session_lifecycle_history (
  id,
  screening_session_id,
  transition_type,
  from_status,
  to_status,
  reason,
  changed_by,
  changed_at,
  prior_row_version,
  resulting_row_version
)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + abs(random() % 4), 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  id,
  'CLOSED',
  'OPEN',
  'CLOSED',
  NULL,
  closed_by,
  closed_at,
  1,
  2
FROM screening_sessions
WHERE status = 'CLOSED';

CREATE UNIQUE INDEX ux_screening_sessions_location_date
  ON screening_sessions (location_id, session_date);

CREATE INDEX ix_screening_sessions_date_status
  ON screening_sessions (session_date DESC, status, id DESC);

CREATE INDEX ix_screening_sessions_location_date_status
  ON screening_sessions (location_id, session_date DESC, status, id DESC);

CREATE INDEX ix_screening_session_lifecycle_history_session_time
  ON screening_session_lifecycle_history (screening_session_id, changed_at ASC, id ASC);

CREATE INDEX ix_screening_session_lifecycle_history_changed_at
  ON screening_session_lifecycle_history (changed_at DESC, id DESC);
