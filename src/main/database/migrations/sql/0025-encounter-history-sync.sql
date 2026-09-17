-- Clinical writes, immutable history and upload signals share the caller's transaction.
CREATE TABLE screening_encounter_review_status_history (
 id TEXT PRIMARY KEY,
 flag_id TEXT NOT NULL REFERENCES screening_encounter_review_flags(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
 from_status TEXT NULL CHECK (from_status IN ('OPEN','RESOLVED','DISMISSED')),
 to_status TEXT NOT NULL CHECK (to_status IN ('OPEN','RESOLVED','DISMISSED')),
 change_reason TEXT NULL CHECK (length(trim(change_reason)) BETWEEN 1 AND 1000),
 changed_by TEXT NOT NULL REFERENCES users(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 changed_at TEXT NOT NULL,
 UNIQUE (flag_id, sequence_number),
 CHECK ((sequence_number = 1 AND from_status IS NULL AND to_status = 'OPEN' AND change_reason IS NULL)
   OR (sequence_number = 2 AND from_status IS NOT NULL AND from_status = 'OPEN' AND to_status IN ('RESOLVED','DISMISSED') AND change_reason IS NOT NULL))
) STRICT;

-- The existing application supports one opening and one resolution/dismissal per flag.
-- Reconstruct only those facts actually retained; never invent earlier actions.
INSERT INTO screening_encounter_review_status_history
 SELECT id,id,1,NULL,'OPEN',NULL,opened_by,opened_at FROM screening_encounter_review_flags;
INSERT INTO screening_encounter_review_status_history
 SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), id,2,'OPEN',status,resolution_note,resolved_by,resolved_at
 FROM screening_encounter_review_flags WHERE status IN ('RESOLVED','DISMISSED');

ALTER TABLE sync_transport_resource_mappings RENAME TO sync_transport_resource_mappings_v24;
CREATE TABLE sync_transport_resource_mappings (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('PATIENT','SCREENING_SESSION','SCREENING_ENCOUNTER','VITALS','LIFESTYLE','FOOD','OTC','REFERRAL','REFERRAL_STATUS','REFERRAL_FOLLOWUP','ENCOUNTER_ADDENDUM','ENCOUNTER_REVIEW_FLAG','ENCOUNTER_REVIEW_STATUS')),
  local_resource_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  canonical_resource_id TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, local_resource_id)
) STRICT;
INSERT INTO sync_transport_resource_mappings SELECT * FROM sync_transport_resource_mappings_v24;
DROP TABLE sync_transport_resource_mappings_v24;
CREATE UNIQUE INDEX ux_sync_transport_resource_mappings_canonical
  ON sync_transport_resource_mappings(resource_type, canonical_resource_id);

-- Retarget legacy signals that were never eligible for transport. Clinical IDs only.
UPDATE sync_outbox SET aggregate_type='ENCOUNTER_HISTORY',
 aggregate_id=json_extract(payload_json,'$.addendum_id'), operation='ENCOUNTER_ADDENDUM_SYNC_REQUESTED',
 payload_json='{}', payload_schema_version='encounter-history.signal.v1'
 WHERE operation='SCREENING_ENCOUNTER_ADDENDUM_ADDED'
 AND json_extract(payload_json,'$.addendum_id') IN (SELECT a.id FROM screening_encounter_addenda a JOIN screening_encounters e ON e.id=a.encounter_id WHERE e.source_type='LOCAL');
UPDATE sync_outbox SET aggregate_type='ENCOUNTER_HISTORY',
 aggregate_id=json_extract(payload_json,'$.flag_id'), operation='ENCOUNTER_REVIEW_FLAG_SYNC_REQUESTED',
 payload_json='{}', payload_schema_version='encounter-history.signal.v1'
 WHERE operation='SCREENING_ENCOUNTER_REVIEW_FLAG_OPENED'
 AND json_extract(payload_json,'$.flag_id') IN (SELECT f.id FROM screening_encounter_review_flags f JOIN screening_encounters e ON e.id=f.encounter_id WHERE e.source_type='LOCAL');
UPDATE sync_outbox SET aggregate_type='ENCOUNTER_HISTORY',
 aggregate_id=(SELECT h.id FROM screening_encounter_review_status_history h
 WHERE h.flag_id=json_extract(sync_outbox.payload_json,'$.flag_id') ORDER BY sequence_number DESC LIMIT 1),
 operation='ENCOUNTER_REVIEW_STATUS_SYNC_REQUESTED', payload_json='{}', payload_schema_version='encounter-history.signal.v1'
 WHERE operation='SCREENING_ENCOUNTER_REVIEW_FLAG_UPDATED'
 AND json_extract(payload_json,'$.flag_id') IN (SELECT h.flag_id FROM screening_encounter_review_status_history h JOIN screening_encounter_review_flags f ON f.id=h.flag_id JOIN screening_encounters e ON e.id=f.encounter_id WHERE h.sequence_number=2 AND e.source_type='LOCAL');

INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',s.id,'ENCOUNTER_ADDENDUM_SYNC_REQUESTED','{}','encounter-history.signal.v1',s.created_at,'PENDING',0
 FROM screening_encounter_addenda s  JOIN screening_encounters e ON e.id=s.encounter_id WHERE e.source_type='LOCAL';
CREATE TRIGGER tr_screening_encounter_addenda_sync AFTER INSERT ON screening_encounter_addenda
 WHEN EXISTS (SELECT 1 FROM screening_encounters e WHERE e.source_type='LOCAL' AND e.id=NEW.encounter_id)
 BEGIN
 INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',NEW.id,'ENCOUNTER_ADDENDUM_SYNC_REQUESTED','{}','encounter-history.signal.v1',NEW.created_at,'PENDING',0);
 END;

INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',s.id,'ENCOUNTER_REVIEW_FLAG_SYNC_REQUESTED','{}','encounter-history.signal.v1',s.opened_at,'PENDING',0
 FROM screening_encounter_review_flags s  JOIN screening_encounters e ON e.id=s.encounter_id WHERE e.source_type='LOCAL';
CREATE TRIGGER tr_screening_encounter_review_flags_sync AFTER INSERT ON screening_encounter_review_flags
 WHEN EXISTS (SELECT 1 FROM screening_encounters e WHERE e.source_type='LOCAL' AND e.id=NEW.encounter_id)
 BEGIN
 INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',NEW.id,'ENCOUNTER_REVIEW_FLAG_SYNC_REQUESTED','{}','encounter-history.signal.v1',NEW.opened_at,'PENDING',0);
 END;

INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',s.id,'ENCOUNTER_REVIEW_STATUS_SYNC_REQUESTED','{}','encounter-history.signal.v1',s.changed_at,'PENDING',0
 FROM screening_encounter_review_status_history s JOIN screening_encounter_review_flags f ON f.id=s.flag_id JOIN screening_encounters e ON e.id=f.encounter_id WHERE e.source_type='LOCAL';
CREATE TRIGGER tr_screening_encounter_review_status_history_sync AFTER INSERT ON screening_encounter_review_status_history
 WHEN EXISTS (SELECT 1 FROM screening_encounters e WHERE e.source_type='LOCAL' AND e.id=(SELECT encounter_id FROM screening_encounter_review_flags WHERE id=NEW.flag_id))
 BEGIN
 INSERT INTO sync_outbox (id,aggregate_type,aggregate_id,operation,payload_json,payload_schema_version,created_at,status,attempt_count)
 VALUES (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),'ENCOUNTER_HISTORY',NEW.id,'ENCOUNTER_REVIEW_STATUS_SYNC_REQUESTED','{}','encounter-history.signal.v1',NEW.changed_at,'PENDING',0);
 END;

CREATE TRIGGER tr_review_flag_open_history AFTER INSERT ON screening_encounter_review_flags
 BEGIN
 INSERT INTO screening_encounter_review_status_history VALUES (NEW.id,NEW.id,1,NULL,'OPEN',NULL,NEW.opened_by,NEW.opened_at);
 INSERT INTO screening_encounter_review_status_history
 SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),NEW.id,2,'OPEN',NEW.status,NEW.resolution_note,NEW.resolved_by,NEW.resolved_at
 WHERE NEW.status IN ('RESOLVED','DISMISSED');
 END;
CREATE TRIGGER tr_review_flag_close_history AFTER UPDATE OF status ON screening_encounter_review_flags
 WHEN OLD.status='OPEN' AND NEW.status IN ('RESOLVED','DISMISSED')
 BEGIN
 INSERT INTO screening_encounter_review_status_history VALUES
 (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),NEW.id,2,'OPEN',NEW.status,NEW.resolution_note,NEW.resolved_by,NEW.resolved_at);
 END;
CREATE TRIGGER tr_review_flag_origin_immutable BEFORE UPDATE ON screening_encounter_review_flags
 WHEN NEW.id IS NOT OLD.id OR NEW.encounter_id IS NOT OLD.encounter_id
 OR NEW.category IS NOT OLD.category OR NEW.description IS NOT OLD.description
 OR NEW.opened_by IS NOT OLD.opened_by OR NEW.opened_at IS NOT OLD.opened_at
 OR (OLD.status <> 'OPEN' AND (NEW.status IS NOT OLD.status OR NEW.resolved_by IS NOT OLD.resolved_by
 OR NEW.resolved_at IS NOT OLD.resolved_at OR NEW.resolution_note IS NOT OLD.resolution_note))
 BEGIN SELECT RAISE(ABORT,'Encounter review history is immutable'); END;
CREATE TRIGGER tr_review_flag_no_delete BEFORE DELETE ON screening_encounter_review_flags
 BEGIN SELECT RAISE(ABORT,'Encounter review history is immutable'); END;
CREATE TRIGGER tr_screening_encounter_addenda_no_update BEFORE UPDATE ON screening_encounter_addenda
 BEGIN SELECT RAISE(ABORT,'Encounter history is immutable'); END;
CREATE TRIGGER tr_screening_encounter_addenda_no_delete BEFORE DELETE ON screening_encounter_addenda
 BEGIN SELECT RAISE(ABORT,'Encounter history is immutable'); END;
CREATE TRIGGER tr_screening_encounter_review_status_history_no_update BEFORE UPDATE ON screening_encounter_review_status_history
 BEGIN SELECT RAISE(ABORT,'Encounter history is immutable'); END;
CREATE TRIGGER tr_screening_encounter_review_status_history_no_delete BEFORE DELETE ON screening_encounter_review_status_history
 BEGIN SELECT RAISE(ABORT,'Encounter history is immutable'); END;
