ALTER TABLE sync_transport_batches
ADD COLUMN response_json TEXT NULL CHECK (
  response_json IS NULL OR json_valid(response_json) = 1
);

ALTER TABLE sync_transport_batches
ADD COLUMN response_sha256 TEXT NULL CHECK (
  (response_json IS NULL AND response_sha256 IS NULL) OR (
    response_json IS NOT NULL AND
    response_sha256 IS NOT NULL AND
    length(response_sha256) = 64 AND
    response_sha256 NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TRIGGER tr_sync_transport_batches_response_immutable
BEFORE UPDATE OF response_json, response_sha256 ON sync_transport_batches
FOR EACH ROW
WHEN OLD.response_json IS NOT NULL AND (
  NEW.response_json IS NOT OLD.response_json OR
  NEW.response_sha256 IS NOT OLD.response_sha256
)
BEGIN
  SELECT RAISE(ABORT, 'sync transport response is immutable');
END;

ALTER TABLE sync_transport_batch_items RENAME TO sync_transport_batch_items_v19;

CREATE TABLE sync_transport_batch_items (
  batch_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  PRIMARY KEY (batch_id, sequence_number),
  CONSTRAINT ux_sync_transport_batch_items_batch_outbox UNIQUE (batch_id, outbox_id),
  CONSTRAINT fk_sync_transport_batch_items_batch FOREIGN KEY (batch_id)
    REFERENCES sync_transport_batches (id) ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_sync_transport_batch_items_outbox FOREIGN KEY (outbox_id)
    REFERENCES sync_outbox (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

INSERT INTO sync_transport_batch_items (batch_id, outbox_id, sequence_number)
SELECT batch_id, outbox_id, sequence_number
FROM sync_transport_batch_items_v19;

DROP TABLE sync_transport_batch_items_v19;

CREATE INDEX ix_sync_transport_batch_items_outbox_history
  ON sync_transport_batch_items (outbox_id, batch_id);

CREATE TABLE sync_transport_resource_mappings (
  resource_type TEXT NOT NULL CHECK (
    resource_type IN ('PATIENT', 'SCREENING_SESSION', 'SCREENING_ENCOUNTER', 'VITALS', 'LIFESTYLE')
  ),
  local_resource_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  canonical_resource_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, local_resource_id)
) STRICT;

CREATE UNIQUE INDEX ux_sync_transport_resource_mappings_canonical
  ON sync_transport_resource_mappings (resource_type, canonical_resource_id);
