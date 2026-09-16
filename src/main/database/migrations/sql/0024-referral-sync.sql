ALTER TABLE sync_transport_resource_mappings RENAME TO sync_transport_resource_mappings_v23;
CREATE TABLE sync_transport_resource_mappings (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('PATIENT','SCREENING_SESSION','SCREENING_ENCOUNTER','VITALS','LIFESTYLE','FOOD','OTC','REFERRAL','REFERRAL_STATUS','REFERRAL_FOLLOWUP')),
  local_resource_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  canonical_resource_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, local_resource_id)
) STRICT;
INSERT INTO sync_transport_resource_mappings SELECT * FROM sync_transport_resource_mappings_v23;
DROP TABLE sync_transport_resource_mappings_v23;
CREATE UNIQUE INDEX ux_sync_transport_resource_mappings_canonical
  ON sync_transport_resource_mappings(resource_type, canonical_resource_id);


INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version, created_at, status, attempt_count)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'REFERRAL', id, 'REFERRAL_SYNC_REQUESTED', '{}', 'referral-history.signal.v1', updated_at, 'PENDING', 0 FROM referrals;

INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version, created_at, status, attempt_count)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'REFERRAL_HISTORY', id, 'REFERRAL_STATUS_HISTORY_RECORDED', '{}', 'referral-history.signal.v1', changed_at, 'PENDING', 0 FROM referral_status_history;

INSERT INTO sync_outbox (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version, created_at, status, attempt_count)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), 'REFERRAL_HISTORY', id, 'REFERRAL_FOLLOWUP_SYNC_REQUESTED', '{}', 'referral-history.signal.v1', recorded_at, 'PENDING', 0 FROM followups;
