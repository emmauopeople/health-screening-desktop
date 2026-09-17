import { createHash } from 'node:crypto'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { SnapshotValueError } from './sync-snapshot-diagnostics'
import type { MaterializedSyncJsonValue, MaterializedSyncRecord } from './sync-snapshot-types'

type HistoryType = 'ENCOUNTER_ADDENDUM' | 'ENCOUNTER_REVIEW_FLAG' | 'ENCOUNTER_REVIEW_STATUS'
const tables = {
  ENCOUNTER_ADDENDUM: 'screening_encounter_addenda',
  ENCOUNTER_REVIEW_FLAG: 'screening_encounter_review_flags',
  ENCOUNTER_REVIEW_STATUS: 'screening_encounter_review_status_history'
} as const
const schemas = {
  ENCOUNTER_ADDENDUM: 'encounter-addendum.v1',
  ENCOUNTER_REVIEW_FLAG: 'encounter-review-flag.v1',
  ENCOUNTER_REVIEW_STATUS: 'encounter-review-status.v1'
} as const
export function materializeEncounterHistory(
  connection: DatabaseTransactionConnection,
  installation: { installationId: EntityId; locationId: EntityId },
  id: EntityId,
  type: HistoryType
): { record: MaterializedSyncRecord; actorIds: ReadonlySet<EntityId> } {
  const event = type === 'ENCOUNTER_REVIEW_STATUS'
  const row = connection
    .prepare(
      `SELECT s.*, e.location_id,e.source_type AS encounter_source_type
    FROM ${tables[type]} s ${event ? 'JOIN screening_encounter_review_flags f ON f.id=s.flag_id' : ''}
    JOIN screening_encounters e ON e.id=${event ? 'f' : 's'}.encounter_id WHERE s.id=?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) throw new SnapshotValueError('MISSING_ROW')
  if (row.location_id !== installation.locationId || row.encounter_source_type !== 'LOCAL')
    throw new SnapshotValueError('LOCATION_MISMATCH')
  const text = (column: string, maximum: number): string => {
    const v = row[column]
    if (typeof v !== 'string' || !v.trim() || v.length > maximum)
      throw new SnapshotValueError('INVALID_VALUE')
    return v
  }
  const actor = parseEntityId(
    row[event ? 'changed_by' : type === 'ENCOUNTER_ADDENDUM' ? 'created_by' : 'opened_by']
  )
  const time = parseUtcTimestamp(
    row[event ? 'changed_at' : type === 'ENCOUNTER_ADDENDUM' ? 'created_at' : 'opened_at']
  )
  let payload: Record<string, MaterializedSyncJsonValue>
  if (type === 'ENCOUNTER_ADDENDUM')
    payload = {
      localEncounterId: parseEntityId(row.encounter_id),
      noteText: text('note_text', 2000),
      createdByLocalActorId: actor,
      createdAt: time
    }
  else if (type === 'ENCOUNTER_REVIEW_FLAG') {
    const category = text('category', 100)
    if (
      ![
        'POSSIBLE_DATA_ERROR',
        'MISSING_INFORMATION',
        'WRONG_PATIENT',
        'DUPLICATE_ENCOUNTER',
        'OTHER'
      ].includes(category)
    )
      throw new SnapshotValueError('INVALID_VALUE')
    payload = {
      localEncounterId: parseEntityId(row.encounter_id),
      category,
      description: text('description', 1000),
      openedByLocalActorId: actor,
      openedAt: time
    }
  } else {
    const sequence = Number(row.sequence_number)
    const from = row.from_status === null ? null : text('from_status', 20)
    const to = text('to_status', 20)
    const reason = row.change_reason === null ? null : text('change_reason', 1000)
    if (
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      (sequence === 1
        ? from !== null || to !== 'OPEN' || reason !== null
        : from !== 'OPEN' || !['RESOLVED', 'DISMISSED'].includes(to) || reason === null)
    )
      throw new SnapshotValueError('INVALID_VALUE')
    payload = {
      localFlagId: parseEntityId(row.flag_id),
      sequenceNumber: sequence,
      fromStatus: from,
      toStatus: to,
      changeReason: reason,
      changedByLocalActorId: actor,
      changedAt: time
    }
  }
  const digest = createHash('sha256')
    .update(`chs.encounter-history.v1:${installation.installationId}:${type}:${id}:1`)
    .digest('hex')
  const recordId = parseEntityId(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  )
  return {
    record: {
      recordId,
      resourceType: type,
      localResourceId: id,
      sourceRevision: 1,
      schemaVersion: schemas[type],
      operation: 'UPSERT',
      capturedAt: time,
      sourceActorLocalId: actor,
      payload
    },
    actorIds: new Set([actor])
  }
}
