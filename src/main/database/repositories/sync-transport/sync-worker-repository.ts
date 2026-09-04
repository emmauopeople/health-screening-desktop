import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  ContractUuid,
  IdentityResolutionDelivery,
  SyncBatchResponse,
  SyncRecordOutcome
} from '@main/application/sync-transport/sync-contract'
import { parseContractUuid } from '@main/application/sync-transport/sync-contract'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'

export interface PendingIdentityResolutionAcknowledgment {
  readonly resolutionReference: ContractUuid
  readonly acknowledgmentId: EntityId
  readonly appliedAt: UtcTimestamp
  readonly requestJson: string
}

export interface CompleteSyncBatchInput {
  readonly response: SyncBatchResponse
  readonly responseJson: string
  readonly completedAt: UtcTimestamp
  readonly retryAt: UtcTimestamp
  readonly identifierIds: ReadonlyMap<EntityId, EntityId>
}

export interface ApplyIdentityResolutionInput {
  readonly delivery: IdentityResolutionDelivery
  readonly acknowledgmentId: EntityId
  readonly acknowledgmentJson: string
  readonly identifierId: EntityId
  readonly appliedAt: UtcTimestamp
}

export interface SyncWorkerRepository {
  completeBatch(connection: DatabaseTransactionConnection, input: CompleteSyncBatchInput): void
  applyIdentityResolution(
    connection: DatabaseTransactionConnection,
    input: ApplyIdentityResolutionInput
  ): boolean
  listPendingIdentityResolutionAcknowledgments(): readonly PendingIdentityResolutionAcknowledgment[]
  markIdentityResolutionAcknowledged(
    connection: DatabaseTransactionConnection,
    resolutionReference: ContractUuid,
    acknowledgmentId: EntityId,
    acknowledgedAt: UtcTimestamp
  ): void
}

export function createSyncWorkerRepository(connection: Database.Database): SyncWorkerRepository {
  return Object.freeze({
    completeBatch(
      scopedConnection: DatabaseTransactionConnection,
      input: CompleteSyncBatchInput
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      validateCompleteInput(input)
      try {
        const batch = scopedConnection
          .prepare(
            'SELECT status, active_attempt_id, response_json FROM sync_transport_batches WHERE id = ?'
          )
          .get(input.response.batchId) as
          { status?: unknown; active_attempt_id?: unknown; response_json?: unknown } | undefined
        if (
          batch === undefined ||
          batch.status !== 'IN_FLIGHT' ||
          typeof batch.active_attempt_id !== 'string' ||
          batch.response_json !== null
        ) {
          throw new RepositoryWriteError()
        }

        const counts: Record<string, number> = {}
        for (const outcome of input.response.outcomes) {
          counts[outcome.status] = (counts[outcome.status] ?? 0) + 1
          if (
            outcome.canonicalResourceId !== null &&
            (outcome.status === 'ACCEPTED' || outcome.status === 'UNCHANGED')
          ) {
            upsertResourceMapping(scopedConnection, outcome, input.completedAt)
          }
          if (
            outcome.resourceType === 'PATIENT' &&
            outcome.centralPersonId !== null &&
            outcome.chsMedicalId !== null &&
            (outcome.medicalIdStatus === 'ASSIGNED' || outcome.medicalIdStatus === 'CONFIRMED')
          ) {
            const identifierId = input.identifierIds.get(outcome.localResourceId)
            if (identifierId === undefined) throw new RepositoryWriteError()
            applyIdentityLink(scopedConnection, {
              patientId: outcome.localResourceId,
              centralPersonId: outcome.centralPersonId,
              chsMedicalId: outcome.chsMedicalId,
              sourceRevision: outcome.sourceRevision,
              resolutionReference: null,
              identifierId,
              appliedAt: input.completedAt
            })
          }
          applyOutcomeToOutbox(scopedConnection, input.response.batchId, outcome, input)
        }

        const attemptResult = scopedConnection
          .prepare(
            `UPDATE sync_attempts
             SET ended_at = ?, status = 'COMPLETED', item_counts_json = ?, error_summary = NULL
             WHERE id = ? AND ended_at IS NULL`
          )
          .run(input.completedAt, JSON.stringify(counts), batch.active_attempt_id)
        if (attemptResult.changes !== 1) throw new RepositoryWriteError()

        const responseSha256 = createHash('sha256').update(input.responseJson).digest('hex')
        const batchResult = scopedConnection
          .prepare(
            `UPDATE sync_transport_batches
             SET status = 'COMPLETED', next_attempt_at = NULL, lease_expires_at = NULL,
                 active_attempt_id = NULL, last_error_code = NULL, completed_at = ?,
                 response_json = ?, response_sha256 = ?
             WHERE id = ? AND status = 'IN_FLIGHT'`
          )
          .run(input.completedAt, input.responseJson, responseSha256, input.response.batchId)
        if (batchResult.changes !== 1) throw new RepositoryWriteError()
      } catch (error) {
        if (error instanceof RepositoryWriteError) throw error
        throw new RepositoryWriteError(error instanceof Error ? error.name : typeof error)
      }
    },

    applyIdentityResolution(
      scopedConnection: DatabaseTransactionConnection,
      input: ApplyIdentityResolutionInput
    ): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      parseEntityId(input.acknowledgmentId)
      parseEntityId(input.identifierId)
      parseUtcTimestamp(input.appliedAt)
      validateAcknowledgmentJson(input)
      try {
        const existing = scopedConnection
          .prepare(
            'SELECT * FROM sync_identity_resolution_deliveries WHERE resolution_reference = ?'
          )
          .get(input.delivery.resolutionReference) as Record<string, unknown> | undefined
        if (existing !== undefined) {
          if (
            existing.local_patient_id !== input.delivery.localPatientReference ||
            existing.local_patient_code !== input.delivery.localPatientCode ||
            existing.source_revision !== input.delivery.sourceRevision ||
            existing.central_person_id !== input.delivery.centralPersonId ||
            existing.chs_medical_id !== input.delivery.chsMedicalId ||
            existing.resolved_at !== input.delivery.resolvedAt
          ) {
            throw new RepositoryWriteError()
          }
          return false
        }

        const patient = scopedConnection
          .prepare('SELECT patient_code, row_version FROM patients WHERE id = ?')
          .get(input.delivery.localPatientReference) as
          { patient_code?: unknown; row_version?: unknown } | undefined
        if (
          patient === undefined ||
          patient.patient_code !== input.delivery.localPatientCode ||
          patient.row_version !== input.delivery.sourceRevision
        ) {
          throw new RepositoryWriteError()
        }

        applyIdentityLink(scopedConnection, {
          patientId: input.delivery.localPatientReference,
          centralPersonId: input.delivery.centralPersonId,
          chsMedicalId: input.delivery.chsMedicalId,
          sourceRevision: input.delivery.sourceRevision,
          resolutionReference: input.delivery.resolutionReference,
          identifierId: input.identifierId,
          appliedAt: input.appliedAt
        })
        const result = scopedConnection
          .prepare(
            `INSERT INTO sync_identity_resolution_deliveries (
               resolution_reference, local_patient_id, local_patient_code, source_revision,
               central_person_id, chs_medical_id, resolved_at, acknowledgment_id,
               acknowledgment_json, applied_at, acknowledged_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(
            input.delivery.resolutionReference,
            input.delivery.localPatientReference,
            input.delivery.localPatientCode,
            input.delivery.sourceRevision,
            input.delivery.centralPersonId,
            input.delivery.chsMedicalId,
            input.delivery.resolvedAt,
            input.acknowledgmentId,
            input.acknowledgmentJson,
            input.appliedAt
          )
        if (result.changes !== 1) throw new RepositoryWriteError()
        return true
      } catch (error) {
        if (error instanceof RepositoryWriteError) throw error
        throw new RepositoryWriteError(error instanceof Error ? error.name : typeof error)
      }
    },

    listPendingIdentityResolutionAcknowledgments() {
      try {
        return (
          connection
            .prepare(
              `SELECT resolution_reference, acknowledgment_id, acknowledgment_json, applied_at
               FROM sync_identity_resolution_deliveries
               WHERE acknowledged_at IS NULL
               ORDER BY applied_at, resolution_reference`
            )
            .all() as readonly Record<string, unknown>[]
        ).map((row) => {
          const pending = Object.freeze({
            resolutionReference: parseContractUuid(row.resolution_reference),
            acknowledgmentId: parseEntityId(row.acknowledgment_id),
            appliedAt: parseUtcTimestamp(row.applied_at),
            requestJson: requiredString(row.acknowledgment_json)
          })
          validateStoredAcknowledgmentJson(pending)
          return pending
        })
      } catch (error) {
        throw new RepositoryReadError(error instanceof Error ? error.name : typeof error)
      }
    },

    markIdentityResolutionAcknowledged(
      scopedConnection: DatabaseTransactionConnection,
      resolutionReference: ContractUuid,
      acknowledgmentId: EntityId,
      acknowledgedAt: UtcTimestamp
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      parseContractUuid(resolutionReference)
      parseEntityId(acknowledgmentId)
      parseUtcTimestamp(acknowledgedAt)
      try {
        const result = scopedConnection
          .prepare(
            `UPDATE sync_identity_resolution_deliveries
             SET acknowledged_at = ?
             WHERE resolution_reference = ? AND acknowledgment_id = ?
               AND acknowledged_at IS NULL`
          )
          .run(acknowledgedAt, resolutionReference, acknowledgmentId)
        if (result.changes !== 1) throw new RepositoryWriteError()
      } catch (error) {
        if (error instanceof RepositoryWriteError) throw error
        throw new RepositoryWriteError(error instanceof Error ? error.name : typeof error)
      }
    }
  })
}

function applyOutcomeToOutbox(
  connection: DatabaseTransactionConnection,
  batchId: EntityId,
  outcome: SyncRecordOutcome,
  input: CompleteSyncBatchInput
): void {
  const outboxIds = matchingOutboxIds(connection, batchId, outcome)
  if (outboxIds.length === 0) throw new RepositoryWriteError()
  const retryable =
    outcome.status === 'RETRY' ||
    (outcome.status === 'REJECTED' && outcome.errors.some((error) => error.retryable))
  const errorCode = outcome.errors[0]?.code ?? (retryable ? 'RETRY_OUTCOME' : null)
  const statement = retryable
    ? connection.prepare(
        `UPDATE sync_outbox
         SET status = 'FAILED', attempt_count = attempt_count + 1, next_attempt_at = ?,
             last_error_code = ?, last_error_message = NULL, sent_at = NULL
         WHERE id = ? AND status = 'IN_FLIGHT'`
      )
    : connection.prepare(
        `UPDATE sync_outbox
         SET status = 'SENT', attempt_count = attempt_count + 1, next_attempt_at = NULL,
             last_error_code = ?, last_error_message = NULL, sent_at = ?
         WHERE id = ? AND status = 'IN_FLIGHT'`
      )
  for (const outboxId of outboxIds) {
    const result = retryable
      ? statement.run(input.retryAt, errorCode, outboxId)
      : statement.run(outcome.status === 'REJECTED' ? errorCode : null, input.completedAt, outboxId)
    if (result.changes !== 1) throw new RepositoryWriteError()
  }
}

function matchingOutboxIds(
  connection: DatabaseTransactionConnection,
  batchId: EntityId,
  outcome: SyncRecordOutcome
): readonly EntityId[] {
  const operationCondition =
    outcome.resourceType === 'VITALS'
      ? "outbox.operation = 'SCREENING_VITALS_STEP_COMPLETED'"
      : outcome.resourceType === 'LIFESTYLE'
        ? "outbox.operation = 'SCREENING_LIFESTYLE_STEP_COMPLETED'"
        : outcome.resourceType === 'SCREENING_ENCOUNTER'
          ? "outbox.operation IN ('SCREENING_ENCOUNTER_STARTED', 'SCREENING_ENCOUNTER_COMPLETED', 'SCREENING_ENCOUNTER_VOIDED')"
          : '1 = 1'
  const aggregateType =
    outcome.resourceType === 'PATIENT'
      ? 'PATIENT'
      : outcome.resourceType === 'SCREENING_SESSION'
        ? 'SCREENING_SESSION'
        : 'SCREENING_ENCOUNTER'
  const aggregateId =
    outcome.resourceType === 'VITALS'
      ? lookupParent(connection, 'screening_vitals_drafts', outcome.localResourceId)
      : outcome.resourceType === 'LIFESTYLE'
        ? lookupParent(connection, 'lifestyle_drafts', outcome.localResourceId)
        : outcome.localResourceId
  return (
    connection
      .prepare(
        `SELECT item.outbox_id
         FROM sync_transport_batch_items AS item
         JOIN sync_outbox AS outbox ON outbox.id = item.outbox_id
         WHERE item.batch_id = ? AND outbox.aggregate_type = ?
           AND outbox.aggregate_id = ? AND ${operationCondition}
         ORDER BY item.sequence_number`
      )
      .all(batchId, aggregateType, aggregateId) as readonly { outbox_id: unknown }[]
  ).map((row) => parseEntityId(row.outbox_id))
}

function lookupParent(
  connection: DatabaseTransactionConnection,
  table: 'screening_vitals_drafts' | 'lifestyle_drafts',
  localResourceId: EntityId
): EntityId {
  const row = connection
    .prepare(`SELECT encounter_id FROM ${table} WHERE id = ?`)
    .get(localResourceId) as { encounter_id?: unknown } | undefined
  if (row === undefined) throw new RepositoryWriteError()
  return parseEntityId(row.encounter_id)
}

function upsertResourceMapping(
  connection: DatabaseTransactionConnection,
  outcome: SyncRecordOutcome,
  appliedAt: UtcTimestamp
): void {
  const result = connection
    .prepare(
      `INSERT INTO sync_transport_resource_mappings (
         resource_type, local_resource_id, source_revision, canonical_resource_id, applied_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(resource_type, local_resource_id) DO UPDATE SET
         source_revision = excluded.source_revision,
         applied_at = excluded.applied_at
       WHERE sync_transport_resource_mappings.canonical_resource_id = excluded.canonical_resource_id
         AND sync_transport_resource_mappings.source_revision <= excluded.source_revision`
    )
    .run(
      outcome.resourceType,
      outcome.localResourceId,
      outcome.sourceRevision,
      outcome.canonicalResourceId,
      appliedAt
    )
  if (result.changes !== 1) throw new RepositoryWriteError()
}

function applyIdentityLink(
  connection: DatabaseTransactionConnection,
  input: Readonly<{
    patientId: EntityId
    centralPersonId: ContractUuid
    chsMedicalId: string
    sourceRevision: number
    resolutionReference: ContractUuid | null
    identifierId: EntityId
    appliedAt: UtcTimestamp
  }>
): void {
  const patient = connection
    .prepare('SELECT created_by FROM patients WHERE id = ?')
    .get(input.patientId) as { created_by?: unknown } | undefined
  if (patient === undefined) throw new RepositoryWriteError()

  const identifiers = connection
    .prepare(
      `SELECT patient_id, identifier_value, status FROM patient_identifiers
       WHERE identifier_type = 'CHS_MEDICAL_ID'
         AND (patient_id = ? OR identifier_value = ?)`
    )
    .all(input.patientId, input.chsMedicalId) as readonly {
    patient_id?: unknown
    identifier_value?: unknown
    status?: unknown
  }[]
  if (
    identifiers.length > 1 ||
    identifiers.some(
      (row) =>
        row.patient_id !== input.patientId ||
        row.identifier_value !== input.chsMedicalId ||
        row.status !== 'ACTIVE'
    )
  ) {
    throw new RepositoryWriteError()
  }
  if (identifiers.length === 0) {
    const result = connection
      .prepare(
        `INSERT INTO patient_identifiers (
           id, patient_id, identifier_type, issuer, identifier_value, is_primary,
           valid_from, valid_to, created_by, created_at, status
         ) VALUES (?, ?, 'CHS_MEDICAL_ID', 'CHS_CENTRAL', ?, 1, ?, NULL, ?, ?, 'ACTIVE')`
      )
      .run(
        input.identifierId,
        input.patientId,
        input.chsMedicalId,
        input.appliedAt,
        parseEntityId(patient.created_by),
        input.appliedAt
      )
    if (result.changes !== 1) throw new RepositoryWriteError()
  }

  const result = connection
    .prepare(
      `INSERT INTO sync_patient_identity_links (
         patient_id, central_person_id, chs_medical_id, source_revision,
         resolution_reference, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(patient_id) DO UPDATE SET
         source_revision = MAX(sync_patient_identity_links.source_revision, excluded.source_revision),
         resolution_reference = COALESCE(sync_patient_identity_links.resolution_reference, excluded.resolution_reference),
         applied_at = excluded.applied_at
       WHERE sync_patient_identity_links.central_person_id = excluded.central_person_id
         AND sync_patient_identity_links.chs_medical_id = excluded.chs_medical_id
         AND (
           sync_patient_identity_links.resolution_reference IS NULL
           OR excluded.resolution_reference IS NULL
           OR sync_patient_identity_links.resolution_reference = excluded.resolution_reference
         )`
    )
    .run(
      input.patientId,
      input.centralPersonId,
      input.chsMedicalId,
      input.sourceRevision,
      input.resolutionReference,
      input.appliedAt
    )
  if (result.changes !== 1) throw new RepositoryWriteError()
}

function validateAcknowledgmentJson(input: ApplyIdentityResolutionInput): void {
  parseContractUuid(input.delivery.resolutionReference)
  const expected = JSON.stringify({
    contractVersion: '1.0',
    acknowledgmentId: input.acknowledgmentId,
    resolutionReference: input.delivery.resolutionReference,
    appliedAt: input.appliedAt
  })
  if (input.acknowledgmentJson !== expected) throw new RepositoryValidationError()
}

function validateStoredAcknowledgmentJson(pending: PendingIdentityResolutionAcknowledgment): void {
  const expected = JSON.stringify({
    contractVersion: '1.0',
    acknowledgmentId: pending.acknowledgmentId,
    resolutionReference: pending.resolutionReference,
    appliedAt: pending.appliedAt
  })
  if (pending.requestJson !== expected) throw new RepositoryReadError()
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new RepositoryReadError()
  return value
}

function validateCompleteInput(input: CompleteSyncBatchInput): void {
  parseEntityId(input.response.batchId)
  parseUtcTimestamp(input.completedAt)
  parseUtcTimestamp(input.retryAt)
  if (input.retryAt < input.completedAt || input.responseJson.length === 0) {
    throw new RepositoryValidationError()
  }
}
