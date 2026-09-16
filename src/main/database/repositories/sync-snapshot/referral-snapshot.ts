import { createHash } from 'node:crypto'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'
import { SnapshotValueError } from './sync-snapshot-diagnostics'
import type { MaterializedSyncJsonValue, MaterializedSyncRecord } from './sync-snapshot-types'

type ReferralType = 'REFERRAL' | 'REFERRAL_STATUS' | 'REFERRAL_FOLLOWUP'
type Row = Record<string, unknown>

export function materializeReferral(
  connection: DatabaseTransactionConnection,
  installation: { installationId: EntityId; locationId: EntityId },
  id: EntityId,
  type: ReferralType
): { record: MaterializedSyncRecord; actorIds: ReadonlySet<EntityId> } {
  const table =
    type === 'REFERRAL'
      ? 'referrals'
      : type === 'REFERRAL_STATUS'
        ? 'referral_status_history'
        : 'followups'
  const source = connection
    .prepare(
      `SELECT s.*, e.location_id, e.source_type AS encounter_source_type
    FROM ${table} s ${type === 'REFERRAL' ? '' : 'JOIN referrals r ON r.id=s.referral_id'}
    JOIN screening_encounters e ON e.id=${type === 'REFERRAL' ? 's' : 'r'}.encounter_id WHERE s.id=?`
    )
    .get(id) as Row | undefined
  if (!source) throw new SnapshotValueError('MISSING_ROW')
  if (source.location_id !== installation.locationId || source.encounter_source_type !== 'LOCAL')
    throw new SnapshotValueError('LOCATION_MISMATCH')
  const actorIds = new Set<EntityId>()
  const actor = (value: unknown): EntityId => {
    const parsed = parseEntityId(value)
    actorIds.add(parsed)
    return parsed
  }
  const payload: Record<string, MaterializedSyncJsonValue> = {}
  const copy = (mapping: Record<string, string>): void => {
    for (const [key, column] of Object.entries(mapping)) {
      const value = source[column]
      if (value !== null && typeof value !== 'string') throw new SnapshotValueError('INVALID_VALUE')
      payload[key] = value
    }
  }
  let sourceActorLocalId: EntityId
  let capturedAt: ReturnType<typeof parseUtcTimestamp>
  let revision = 1
  if (type === 'REFERRAL') {
    if (!Number.isSafeInteger(source.record_version) || Number(source.record_version) < 1)
      throw new SnapshotValueError('INVALID_VALUE')
    revision = Number(source.record_version)
    // The audit entry identifies the actual author of this revision, including a follow-up
    // which leaves the status unchanged. Never substitute the encounter's original recorder.
    const mutation =
      revision === 1
        ? { user_id: source.created_by }
        : (connection
            .prepare(
              `SELECT user_id FROM audit_log
      WHERE entity_type='REFERRAL' AND entity_id=? AND action IN ('REFERRAL_STATUS_UPDATED','REFERRAL_FOLLOWUP_RECORDED')
      AND json_extract(metadata_json,'$.record_version')=? ORDER BY occurred_at DESC, id DESC LIMIT 1`
            )
            .get(id, revision) as Row | undefined)
    sourceActorLocalId = actor(mutation?.user_id)
    capturedAt = parseUtcTimestamp(source.updated_at)
    copy({
      reasonText: 'reason_text',
      urgency: 'urgency',
      destinationName: 'destination_name',
      dueDate: 'due_date',
      status: 'status',
      closureReason: 'closure_reason'
    })
    const reasons: unknown = JSON.parse(String(source.reason_codes_json))
    if (!Array.isArray(reasons) || !reasons.every((v) => typeof v === 'string'))
      throw new SnapshotValueError('INVALID_VALUE')
    Object.assign(payload, {
      localPatientId: parseEntityId(source.patient_id),
      localEncounterId: parseEntityId(source.encounter_id),
      localProtocolVersionId: parseEntityId(source.protocol_version_id),
      reasonCodes: reasons,
      createdByLocalActorId: actor(source.created_by),
      createdAt: parseUtcTimestamp(source.created_at),
      updatedByLocalActorId: sourceActorLocalId,
      updatedAt: capturedAt,
      closedByLocalActorId: source.closed_by === null ? null : actor(source.closed_by),
      closedAt: source.closed_at === null ? null : parseUtcTimestamp(source.closed_at)
    })
  } else if (type === 'REFERRAL_STATUS') {
    sourceActorLocalId = actor(source.changed_by)
    capturedAt = parseUtcTimestamp(source.changed_at)
    // rowid captures insertion order even when multiple changes share one clock tick.
    const sequence = connection
      .prepare(
        `SELECT count(*) AS n FROM referral_status_history
      WHERE referral_id=? AND rowid <= (SELECT rowid FROM referral_status_history WHERE id=?)`
      )
      .get(source.referral_id, id) as { n: number }
    copy({ fromStatus: 'from_status', toStatus: 'to_status', changeReason: 'change_reason' })
    Object.assign(payload, {
      localReferralId: parseEntityId(source.referral_id),
      sequenceNumber: sequence.n,
      changedByLocalActorId: sourceActorLocalId,
      changedAt: capturedAt
    })
  } else {
    sourceActorLocalId = actor(source.recorded_by)
    capturedAt = parseUtcTimestamp(source.recorded_at)
    copy({
      contactDate: 'contact_date',
      contactMethod: 'contact_method',
      informationSource: 'information_source',
      facilityName: 'facility_name',
      dateSeen: 'date_seen',
      reportedOutcome: 'reported_outcome',
      reportedMedicationsOrAdvice: 'reported_medications_or_advice',
      nextAction: 'next_action',
      nextFollowupDate: 'next_followup_date',
      sourceType: 'source_type'
    })
    if (source.provider_seen !== null && source.provider_seen !== 0 && source.provider_seen !== 1)
      throw new SnapshotValueError('INVALID_VALUE')
    const actions = connection
      .prepare(
        `SELECT id,sequence_number,action_code FROM referral_followup_actions WHERE followup_id=? ORDER BY sequence_number`
      )
      .all(id) as Row[]
    const meds = connection
      .prepare(
        `SELECT * FROM referral_followup_medication_changes WHERE followup_id=? ORDER BY sequence_number`
      )
      .all(id) as Row[]
    Object.assign(payload, {
      localReferralId: parseEntityId(source.referral_id),
      providerSeen: source.provider_seen === null ? null : source.provider_seen === 1,
      recordedByLocalActorId: sourceActorLocalId,
      recordedAt: capturedAt,
      treatmentActions: actions.map((a) => ({
        localActionId: parseEntityId(a.id),
        sequenceNumber: a.sequence_number,
        actionCode: a.action_code
      })),
      medicationChanges: meds.map((m) => ({
        localMedicationChangeId: parseEntityId(m.id),
        sequenceNumber: m.sequence_number,
        changeType: m.change_type,
        medicationName: m.medication_name,
        dosage: m.dosage,
        frequency: m.frequency
      }))
    })
  }
  // Multiple pending signals and backfill must yield exactly the same record identity.
  const digest = createHash('sha256')
    .update(`chs.referral.v1:${installation.installationId}:${type}:${id}:${revision}`)
    .digest('hex')
  const recordId = parseEntityId(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  )
  return {
    record: {
      recordId,
      resourceType: type,
      localResourceId: id,
      sourceRevision: revision,
      schemaVersion:
        type === 'REFERRAL'
          ? 'referral.v1'
          : type === 'REFERRAL_STATUS'
            ? 'referral-status.v1'
            : 'referral-followup.v1',
      operation: 'UPSERT',
      capturedAt,
      sourceActorLocalId,
      payload
    },
    actorIds
  }
}
