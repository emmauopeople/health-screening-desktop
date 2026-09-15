import { isDeepStrictEqual } from 'node:util'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import { SnapshotValueError } from './sync-snapshot-diagnostics'
import type { MaterializedSyncRecord } from './sync-snapshot-types'

interface HistoryEntry {
  batchId: string
  record: MaterializedSyncRecord
  outcome: { status: string; errors: readonly { code: string }[] } | null
}

// A source revision represents one immutable snapshot, even when several outbox
// signals for that revision fall into different batches.
export function readPatientSnapshotHistory(
  connection: DatabaseTransactionConnection,
  installation: { installationId: EntityId; locationId: EntityId; timezone: string }
): {
  stabilize(record: MaterializedSyncRecord): MaterializedSyncRecord
  queueRepairs(now: UtcTimestamp): void
} {
  const rows = connection
    .prepare(
      `SELECT batch.id AS batch_id, record.value AS record_json,
      (SELECT outcome.value FROM json_each(batch.response_json, '$.outcomes') outcome
       WHERE json_extract(outcome.value, '$.recordId') = json_extract(record.value, '$.recordId')
         AND json_extract(outcome.value, '$.resourceType') = 'PATIENT' LIMIT 1) AS outcome_json
     FROM sync_transport_batches batch, json_each(batch.request_json, '$.records') record
     WHERE json_extract(batch.request_json, '$.installationId') = ?
       AND json_extract(batch.request_json, '$.locationId') = ?
       AND json_extract(batch.request_json, '$.installationTimezone') = ?
       AND json_extract(record.value, '$.resourceType') = 'PATIENT'
     ORDER BY batch.rowid, record.key`
    )
    .all(installation.installationId, installation.locationId, installation.timezone) as {
    batch_id: string
    record_json: string
    outcome_json: string | null
  }[]
  const first = new Map<string, HistoryEntry>()
  const entries: HistoryEntry[] = []
  const key = (record: MaterializedSyncRecord): string =>
    `${record.localResourceId}:${record.sourceRevision}`
  for (const row of rows) {
    const entry: HistoryEntry = {
      batchId: row.batch_id,
      record: JSON.parse(row.record_json),
      outcome: row.outcome_json === null ? null : JSON.parse(row.outcome_json)
    }
    entries.push(entry)
    if (!first.has(key(entry.record))) first.set(key(entry.record), entry)
  }

  const equivalent = (
    current: MaterializedSyncRecord,
    prior: MaterializedSyncRecord
  ): MaterializedSyncRecord | null => {
    let payload = current.payload
    if (prior.payload.knownChsMedicalId === null && typeof payload.knownChsMedicalId === 'string') {
      const link = connection
        .prepare(
          `SELECT 1 FROM sync_patient_identity_links
        WHERE patient_id = ? AND source_revision = ? AND chs_medical_id = ?`
        )
        .get(current.localResourceId, current.sourceRevision, payload.knownChsMedicalId)
      if (link !== undefined) payload = { ...payload, knownChsMedicalId: null }
    }
    const candidate = { ...current, recordId: parseEntityId(prior.recordId), payload }
    return isDeepStrictEqual(candidate, prior) ? Object.freeze(candidate) : null
  }

  return {
    stabilize(record): MaterializedSyncRecord {
      const prior = first.get(key(record))
      if (prior === undefined) return record
      const stable = equivalent(record, prior.record)
      if (stable === null) throw new SnapshotValueError('SNAPSHOT_REVISION_CONFLICT')
      return stable
    },
    queueRepairs(now): void {
      for (const entry of entries) {
        if (
          entry.outcome?.status !== 'REJECTED' ||
          !entry.outcome.errors.some((error) => error.code === 'RECORD_PAYLOAD_MISMATCH')
        )
          continue
        const prior = first.get(key(entry.record))
        if (
          prior === undefined ||
          !['ACCEPTED', 'UNCHANGED'].includes(prior.outcome?.status ?? '') ||
          equivalent(entry.record, prior.record) === null
        )
          continue
        // Never replay an obsolete revision or replace clinical edits with old data.
        const patient = connection
          .prepare('SELECT row_version FROM patients WHERE id = ?')
          .get(entry.record.localResourceId) as { row_version: number } | undefined
        if (patient?.row_version !== entry.record.sourceRevision) continue
        connection
          .prepare(
            `INSERT INTO sync_outbox
          (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version, created_at, status, attempt_count)
          SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),
            'PATIENT', ?, 'PATIENT_SYNC_REPLAY_REQUESTED',
            json_object('rejected_batch_id', ?, 'rejected_record_id', ?), 'patient.sync-replay.v1', ?, 'PENDING', 0
          WHERE NOT EXISTS (SELECT 1 FROM sync_outbox WHERE operation = 'PATIENT_SYNC_REPLAY_REQUESTED'
            AND json_extract(payload_json, '$.rejected_batch_id') = ?
            AND json_extract(payload_json, '$.rejected_record_id') = ?)`
          )
          .run(
            entry.record.localResourceId,
            entry.batchId,
            entry.record.recordId,
            now,
            entry.batchId,
            entry.record.recordId
          )
      }
    }
  }
}
