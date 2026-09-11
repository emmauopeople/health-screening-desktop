ALTER TABLE sync_transport_resource_mappings RENAME TO sync_transport_resource_mappings_v21;
CREATE TABLE sync_transport_resource_mappings (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('PATIENT','SCREENING_SESSION','SCREENING_ENCOUNTER','VITALS','LIFESTYLE','FOOD','OTC')),
  local_resource_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  canonical_resource_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, local_resource_id)
) STRICT;
INSERT INTO sync_transport_resource_mappings SELECT * FROM sync_transport_resource_mappings_v21;
DROP TABLE sync_transport_resource_mappings_v21;
CREATE UNIQUE INDEX ux_sync_transport_resource_mappings_canonical
  ON sync_transport_resource_mappings(resource_type, canonical_resource_id);

-- Queue already completed local encounters, including those subsequently voided.
INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, operation, payload_json,
  payload_schema_version, created_at, status, attempt_count)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'SCREENING_ENCOUNTER', id, 'SCREENING_FOOD_FINALIZED',
  json_object('encounter_id', id), 'screening-encounter.food-finalized.v1', completed_at, 'PENDING', 0
FROM screening_encounters WHERE completed_at IS NOT NULL AND status IN ('COMPLETED','AMENDED','VOID') AND source_type = 'LOCAL';
INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, operation, payload_json,
  payload_schema_version, created_at, status, attempt_count)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'SCREENING_ENCOUNTER', id, 'SCREENING_OTC_FINALIZED',
  json_object('encounter_id', id), 'screening-encounter.otc-finalized.v1', completed_at, 'PENDING', 0
FROM screening_encounters WHERE completed_at IS NOT NULL AND status IN ('COMPLETED','AMENDED','VOID') AND source_type = 'LOCAL';
