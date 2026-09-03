CREATE TABLE sync_transport_batches (
  id TEXT PRIMARY KEY,
  request_json TEXT NOT NULL CHECK (json_valid(request_json) = 1),
  request_sha256 TEXT NOT NULL CHECK (
    length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('PREPARED', 'IN_FLIGHT', 'RETRY_WAIT', 'COMPLETED')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NULL,
  lease_expires_at TEXT NULL,
  active_attempt_id TEXT NULL,
  last_error_code TEXT NULL CHECK (
    last_error_code IS NULL OR (
      length(last_error_code) BETWEEN 1 AND 64 AND
      last_error_code NOT GLOB '*[^A-Z0-9_]*'
    )
  ),
  completed_at TEXT NULL,
  CONSTRAINT fk_sync_transport_batches_attempt FOREIGN KEY (active_attempt_id)
    REFERENCES sync_attempts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_sync_transport_batches_state CHECK (
    (status = 'PREPARED' AND next_attempt_at IS NULL AND lease_expires_at IS NULL AND active_attempt_id IS NULL AND completed_at IS NULL) OR
    (status = 'IN_FLIGHT' AND next_attempt_at IS NULL AND lease_expires_at IS NOT NULL AND active_attempt_id IS NOT NULL AND completed_at IS NULL) OR
    (status = 'RETRY_WAIT' AND next_attempt_at IS NOT NULL AND lease_expires_at IS NULL AND active_attempt_id IS NULL AND completed_at IS NULL) OR
    (status = 'COMPLETED' AND next_attempt_at IS NULL AND lease_expires_at IS NULL AND active_attempt_id IS NULL AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE TABLE sync_transport_batch_items (
  batch_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL UNIQUE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  PRIMARY KEY (batch_id, sequence_number),
  CONSTRAINT fk_sync_transport_batch_items_batch FOREIGN KEY (batch_id)
    REFERENCES sync_transport_batches (id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_sync_transport_batch_items_outbox FOREIGN KEY (outbox_id)
    REFERENCES sync_outbox (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX ix_sync_transport_batches_ready
  ON sync_transport_batches (status, next_attempt_at, created_at);

CREATE TRIGGER tr_sync_transport_batches_request_immutable
BEFORE UPDATE OF id, request_json, request_sha256, created_at ON sync_transport_batches
FOR EACH ROW
WHEN
  NEW.id <> OLD.id OR
  NEW.request_json <> OLD.request_json OR
  NEW.request_sha256 <> OLD.request_sha256 OR
  NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'sync transport request is immutable');
END;
