CREATE TABLE sync_patient_identity_links (
  patient_id TEXT PRIMARY KEY,
  central_person_id TEXT NOT NULL UNIQUE,
  chs_medical_id TEXT NOT NULL UNIQUE CHECK (
    length(chs_medical_id) = 18 AND
    chs_medical_id GLOB 'CHS-[0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ]-[0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ]-[0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ][0123456789ABCDEFGHJKMNPQRSTVWXYZ]'
  ),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  resolution_reference TEXT NULL UNIQUE,
  applied_at TEXT NOT NULL CHECK (julianday(applied_at) IS NOT NULL),
  CONSTRAINT fk_sync_patient_identity_links_patient FOREIGN KEY (patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE sync_identity_resolution_deliveries (
  resolution_reference TEXT PRIMARY KEY,
  local_patient_id TEXT NOT NULL,
  local_patient_code TEXT NOT NULL CHECK (local_patient_code GLOB 'PT-[0-9][0-9][0-9][0-9][0-9][0-9]'),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  central_person_id TEXT NOT NULL,
  chs_medical_id TEXT NOT NULL,
  resolved_at TEXT NOT NULL CHECK (julianday(resolved_at) IS NOT NULL),
  acknowledgment_id TEXT NOT NULL UNIQUE,
  acknowledgment_json TEXT NOT NULL CHECK (json_valid(acknowledgment_json) = 1),
  applied_at TEXT NOT NULL CHECK (julianday(applied_at) IS NOT NULL),
  acknowledged_at TEXT NULL,
  CONSTRAINT fk_sync_identity_resolution_deliveries_patient FOREIGN KEY (local_patient_id)
    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_sync_identity_resolution_deliveries_ack_time CHECK (
    acknowledged_at IS NULL OR (
      julianday(acknowledged_at) IS NOT NULL AND
      julianday(acknowledged_at) >= julianday(applied_at)
    )
  )
) STRICT;

CREATE INDEX ix_sync_identity_resolution_deliveries_pending
  ON sync_identity_resolution_deliveries (applied_at, resolution_reference)
  WHERE acknowledged_at IS NULL;

CREATE TRIGGER tr_sync_identity_resolution_delivery_immutable
BEFORE UPDATE OF resolution_reference, local_patient_id, local_patient_code, source_revision,
  central_person_id, chs_medical_id, resolved_at, acknowledgment_id, acknowledgment_json,
  applied_at ON sync_identity_resolution_deliveries
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'sync identity resolution delivery is immutable');
END;

CREATE TRIGGER tr_sync_identity_resolution_acknowledgment_immutable
BEFORE UPDATE OF acknowledged_at ON sync_identity_resolution_deliveries
FOR EACH ROW
WHEN OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NOT OLD.acknowledged_at
BEGIN
  SELECT RAISE(ABORT, 'sync identity resolution acknowledgment is immutable');
END;
