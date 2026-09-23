import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import { SnapshotValueError } from './sync-snapshot-diagnostics'
import type { MaterializedSyncRecord } from './sync-snapshot-types'

interface HistoryEntry {
  batchId: string
  record: MaterializedSyncRecord
  outcome: {
    status: string
    errors: readonly { code: string; path: string; retryable: boolean }[]
  } | null
}

// Preserve the original delivery identity when a section's signals span batches.
// Recovery adds a transport signal only; no clinical revision or value changes.
export function readLifestyleSnapshotHistory(
  connection: DatabaseTransactionConnection,
  installation: { installationId: EntityId; locationId: EntityId; timezone: string }
): {
  stabilize(record: MaterializedSyncRecord): MaterializedSyncRecord
  queueRepairs(
    now: UtcTimestamp,
    materialize: (encounterId: EntityId, recordId: EntityId) => MaterializedSyncRecord | null
  ): void
} {
  const rows = connection
    .prepare(
      `SELECT batch.id AS batch_id, record.value AS record_json,
      (SELECT outcome.value FROM json_each(batch.response_json, '$.outcomes') outcome
       WHERE json_extract(outcome.value, '$.recordId') = json_extract(record.value, '$.recordId')
         AND json_extract(outcome.value, '$.resourceType') = 'LIFESTYLE' LIMIT 1) AS outcome_json
     FROM sync_transport_batches batch, json_each(batch.request_json, '$.records') record
     WHERE json_extract(batch.request_json, '$.installationId') = ?
       AND json_extract(batch.request_json, '$.locationId') = ?
       AND json_extract(batch.request_json, '$.installationTimezone') = ?
       AND json_extract(record.value, '$.resourceType') = 'LIFESTYLE'
     ORDER BY batch.rowid, record.key`
    )
    .all(installation.installationId, installation.locationId, installation.timezone) as {
    batch_id: string
    record_json: string
    outcome_json: string | null
  }[]
  const first = new Map<string, HistoryEntry>()
  const latest = new Map<string, HistoryEntry>()
  const key = (record: MaterializedSyncRecord): string =>
    `${record.localResourceId}:${record.sourceRevision}`
  for (const row of rows) {
    const entry: HistoryEntry = {
      batchId: row.batch_id,
      record: JSON.parse(row.record_json),
      outcome: row.outcome_json === null ? null : JSON.parse(row.outcome_json)
    }
    if (!first.has(key(entry.record))) first.set(key(entry.record), entry)
    latest.set(key(entry.record), entry)
  }
  const equivalent = (current: MaterializedSyncRecord, prior: MaterializedSyncRecord): boolean =>
    isDeepStrictEqual({ ...current, recordId: prior.recordId }, prior)

  return {
    stabilize(record): MaterializedSyncRecord {
      const prior = first.get(key(record))
      if (!prior) return record
      if (!equivalent(record, prior.record))
        throw new SnapshotValueError('SNAPSHOT_REVISION_CONFLICT')
      return Object.freeze(prior.record)
    },
    queueRepairs(now, materialize): void {
      for (const entry of latest.values()) {
        const error = entry.outcome?.errors[0]
        if (
          entry.outcome?.status !== 'REJECTED' ||
          entry.outcome.errors.length !== 1 ||
          error?.code !== 'LIFESTYLE_ENCOUNTER_STATE_INVALID' ||
          error.path !== '/payload/localEncounterId' ||
          error.retryable !== false
        )
          continue
        const prior = first.get(key(entry.record))!
        // A changed envelope under the same source revision cannot be repaired
        // by silently changing either the historical request or clinical data.
        if (!isDeepStrictEqual(entry.record, prior.record)) continue
        const encounterId = parseEntityId(entry.record.payload.localEncounterId)
        const current = materialize(encounterId, parseEntityId(prior.record.recordId))
        if (!current || !equivalent(current, prior.record)) continue
        connection
          .prepare(
            `INSERT INTO sync_outbox
           (id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version,
            created_at, status, attempt_count)
           SELECT ?, 'SCREENING_ENCOUNTER', ?, 'LIFESTYLE_SYNC_REPLAY_REQUESTED',
             json_object('local_lifestyle_id', ?, 'source_revision', ?, 'rejected_batch_id', ?, 'rejected_record_id', ?),
             'lifestyle.sync-replay.v1', ?, 'PENDING', 0
           WHERE NOT EXISTS (SELECT 1 FROM sync_outbox
             WHERE operation = 'LIFESTYLE_SYNC_REPLAY_REQUESTED'
               AND json_extract(payload_json, '$.local_lifestyle_id') = ?
               AND json_extract(payload_json, '$.source_revision') = ?)`
          )
          .run(
            randomUUID(),
            encounterId,
            entry.record.localResourceId,
            entry.record.sourceRevision,
            entry.batchId,
            entry.record.recordId,
            now,
            entry.record.localResourceId,
            entry.record.sourceRevision
          )
      }
    }
  }
}
