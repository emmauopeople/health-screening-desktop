import { createHash } from 'node:crypto'
import type {
  SyncBatchResponse,
  SyncRecordOutcome
} from '@main/application/sync-transport/sync-contract'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import { RepositoryValidationError, RepositoryWriteError } from '../repository-errors'

export interface CompleteSyncBatchInput {
  readonly response: SyncBatchResponse
  readonly responseJson: string
  readonly completedAt: UtcTimestamp
  readonly retryAt: UtcTimestamp
}

export interface SyncWorkerRepository {
  completeBatch(connection: DatabaseTransactionConnection, input: CompleteSyncBatchInput): void
}

export function createSyncWorkerRepository(): SyncWorkerRepository {
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

function validateCompleteInput(input: CompleteSyncBatchInput): void {
  parseEntityId(input.response.batchId)
  parseUtcTimestamp(input.completedAt)
  parseUtcTimestamp(input.retryAt)
  if (input.retryAt < input.completedAt || input.responseJson.length === 0) {
    throw new RepositoryValidationError()
  }
}
