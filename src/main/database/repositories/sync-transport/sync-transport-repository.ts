import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  DatabaseTransactionStateError,
  type DatabaseTransactionConnection
} from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import type {
  ClaimSyncTransportBatchInput,
  InsertPreparedSyncTransportBatchInput,
  PreparedSyncTransportBatch,
  RescheduleSyncTransportBatchInput,
  StoredSyncTransportConfiguration,
  SyncTransportBatchRepository,
  SyncTransportBatchStatus
} from './sync-transport-types'

const configurationKey = 'sync.transport.configuration.v1'
const configurationClassification = 'SECRET'
const sha256Pattern = /^[0-9a-f]{64}$/
const errorCodePattern = /^[A-Z0-9_]{1,64}$/

interface BatchRow {
  id?: unknown
  request_json?: unknown
  request_sha256?: unknown
  status?: unknown
  attempt_count?: unknown
  created_at?: unknown
  next_attempt_at?: unknown
  lease_expires_at?: unknown
  active_attempt_id?: unknown
  last_error_code?: unknown
  completed_at?: unknown
}

export function createSyncTransportBatchRepository(
  connection: Database.Database
): SyncTransportBatchRepository {
  return Object.freeze({
    getConfiguration(): StoredSyncTransportConfiguration | null {
      try {
        const row = connection
          .prepare('SELECT value_json, updated_at FROM app_settings WHERE key = ?')
          .get(configurationKey) as { value_json?: unknown; updated_at?: unknown } | undefined
        return row === undefined ? null : decodeConfiguration(row)
      } catch (error) {
        if (error instanceof RepositoryDataIntegrityError) throw error
        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    upsertConfiguration(
      scopedConnection: DatabaseTransactionConnection,
      configuration: StoredSyncTransportConfiguration
    ): void {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      const valueJson = encodeConfiguration(configuration)
      try {
        scopedConnection
          .prepare<[string, string, string, string]>(
            `INSERT INTO app_settings (key, value_json, updated_at, sensitivity_classification)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at,
               sensitivity_classification = excluded.sensitivity_classification`
          )
          .run(configurationKey, valueJson, configuration.updatedAt, configurationClassification)
      } catch (error) {
        throwWriteError(error)
      }
    },

    insertPrepared(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertPreparedSyncTransportBatchInput
    ): PreparedSyncTransportBatch {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      validatePreparedInput(input)
      try {
        scopedConnection
          .prepare<[string, string, string, string]>(
            `INSERT INTO sync_transport_batches (
               id, request_json, request_sha256, status, created_at
             ) VALUES (?, ?, ?, 'PREPARED', ?)`
          )
          .run(input.id, input.requestJson, input.requestSha256, input.createdAt)

        const insertItem = scopedConnection.prepare<[string, string, number]>(
          `INSERT INTO sync_transport_batch_items (batch_id, outbox_id, sequence_number)
           VALUES (?, ?, ?)`
        )
        const reserveOutbox = scopedConnection.prepare<[string]>(
          `UPDATE sync_outbox
           SET status = 'IN_FLIGHT', next_attempt_at = NULL,
               last_error_code = NULL, last_error_message = NULL
           WHERE id = ? AND status IN ('PENDING', 'FAILED')`
        )

        input.outboxIds.forEach((outboxId, index) => {
          if (reserveOutbox.run(outboxId).changes !== 1) throw new RepositoryWriteError()
          insertItem.run(input.id, outboxId, index + 1)
        })
        return readBatchForWrite(scopedConnection, input.id)
      } catch (error) {
        throwWriteError(error)
      }
    },

    findReadyForWrite(
      scopedConnection: DatabaseTransactionConnection,
      now: UtcTimestamp
    ): PreparedSyncTransportBatch | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      parseUtcTimestamp(now)
      try {
        const row = scopedConnection
          .prepare<[string], BatchRow>(
            `SELECT id, request_json, request_sha256, status, attempt_count, created_at,
                    next_attempt_at, lease_expires_at, active_attempt_id, last_error_code,
                    completed_at
             FROM sync_transport_batches
             WHERE status = 'PREPARED'
                OR (status = 'RETRY_WAIT' AND next_attempt_at <= ?)
             ORDER BY created_at, id
             LIMIT 1`
          )
          .get(now)
        return row === undefined ? null : decodeBatch(row)
      } catch (error) {
        if (error instanceof RepositoryDataIntegrityError) throw error
        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    claim(
      scopedConnection: DatabaseTransactionConnection,
      input: ClaimSyncTransportBatchInput
    ): PreparedSyncTransportBatch {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      validateClaimInput(input)
      try {
        scopedConnection
          .prepare<[string, string, string]>(
            `INSERT INTO sync_attempts (
               id, batch_id, started_at, ended_at, status, item_counts_json, error_summary
             ) VALUES (?, ?, ?, NULL, 'IN_FLIGHT', '{}', NULL)`
          )
          .run(input.attemptId, input.batchId, input.startedAt)
        const result = scopedConnection
          .prepare<[string, string, string, string]>(
            `UPDATE sync_transport_batches
             SET status = 'IN_FLIGHT', attempt_count = attempt_count + 1,
                 next_attempt_at = NULL, lease_expires_at = ?,
                 active_attempt_id = ?, last_error_code = NULL
             WHERE id = ?
               AND (status = 'PREPARED' OR (status = 'RETRY_WAIT' AND next_attempt_at <= ?))`
          )
          .run(input.leaseExpiresAt, input.attemptId, input.batchId, input.startedAt)
        if (result.changes !== 1) throw new RepositoryWriteError()
        return readBatchForWrite(scopedConnection, input.batchId)
      } catch (error) {
        throwWriteError(error)
      }
    },

    reschedule(
      scopedConnection: DatabaseTransactionConnection,
      input: RescheduleSyncTransportBatchInput
    ): PreparedSyncTransportBatch {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      validateRescheduleInput(input)
      try {
        const batch = readBatchForWrite(scopedConnection, input.batchId)
        if (batch.status !== 'IN_FLIGHT' || batch.activeAttemptId === null) {
          throw new RepositoryWriteError()
        }
        const attemptResult = scopedConnection
          .prepare<[string, string, string, string]>(
            `UPDATE sync_attempts SET ended_at = ?, status = ?, error_summary = ?
             WHERE id = ? AND ended_at IS NULL`
          )
          .run(input.endedAt, input.attemptStatus, input.errorCode, batch.activeAttemptId)
        if (attemptResult.changes !== 1) throw new RepositoryWriteError()
        const batchResult = scopedConnection
          .prepare<[string, string, string]>(
            `UPDATE sync_transport_batches
             SET status = 'RETRY_WAIT', next_attempt_at = ?, lease_expires_at = NULL,
                 active_attempt_id = NULL, last_error_code = ?
             WHERE id = ? AND status = 'IN_FLIGHT'`
          )
          .run(input.nextAttemptAt, input.errorCode, input.batchId)
        if (batchResult.changes !== 1) throw new RepositoryWriteError()
        return readBatchForWrite(scopedConnection, input.batchId)
      } catch (error) {
        throwWriteError(error)
      }
    },

    recoverExpired(
      scopedConnection: DatabaseTransactionConnection,
      now: UtcTimestamp,
      nextAttemptAt: UtcTimestamp
    ): number {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      parseUtcTimestamp(now)
      parseUtcTimestamp(nextAttemptAt)
      try {
        const expired = scopedConnection
          .prepare<[string], { id: string; active_attempt_id: string }>(
            `SELECT id, active_attempt_id FROM sync_transport_batches
             WHERE status = 'IN_FLIGHT' AND lease_expires_at <= ?
             ORDER BY created_at, id`
          )
          .all(now)
        const updateAttempt = scopedConnection.prepare<[string, string]>(
          `UPDATE sync_attempts
           SET ended_at = ?, status = 'LEASE_EXPIRED', error_summary = 'LEASE_EXPIRED'
           WHERE id = ? AND ended_at IS NULL`
        )
        const updateBatch = scopedConnection.prepare<[string, string]>(
          `UPDATE sync_transport_batches
           SET status = 'RETRY_WAIT', next_attempt_at = ?, lease_expires_at = NULL,
               active_attempt_id = NULL, last_error_code = 'LEASE_EXPIRED'
           WHERE id = ? AND status = 'IN_FLIGHT'`
        )
        for (const row of expired) {
          if (updateAttempt.run(now, row.active_attempt_id).changes !== 1) {
            throw new RepositoryWriteError()
          }
          if (updateBatch.run(nextAttemptAt, row.id).changes !== 1) {
            throw new RepositoryWriteError()
          }
        }
        return expired.length
      } catch (error) {
        throwWriteError(error)
      }
    }
  })
}

function encodeConfiguration(configuration: StoredSyncTransportConfiguration): string {
  validateConfiguration(configuration)
  return JSON.stringify({
    apiBaseUrl: configuration.apiBaseUrl,
    protectedToken: configuration.protectedToken,
    tokenPrefix: configuration.tokenPrefix
  })
}

function decodeConfiguration(row: {
  value_json?: unknown
  updated_at?: unknown
}): StoredSyncTransportConfiguration {
  if (typeof row.value_json !== 'string') throw new RepositoryDataIntegrityError()
  const value = JSON.parse(row.value_json) as unknown
  if (!isRecord(value)) throw new RepositoryDataIntegrityError()
  const configuration = Object.freeze({
    apiBaseUrl: value.apiBaseUrl,
    protectedToken: value.protectedToken,
    tokenPrefix: value.tokenPrefix,
    updatedAt: parseUtcTimestamp(row.updated_at)
  }) as StoredSyncTransportConfiguration
  validateConfiguration(configuration)
  return configuration
}

function validateConfiguration(configuration: StoredSyncTransportConfiguration): void {
  if (
    typeof configuration.apiBaseUrl !== 'string' ||
    typeof configuration.protectedToken !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(configuration.protectedToken) ||
    typeof configuration.tokenPrefix !== 'string' ||
    !/^chs_inst_v1_[A-Za-z0-9_-]{8}$/.test(configuration.tokenPrefix)
  ) {
    throw new RepositoryValidationError()
  }
  parseUtcTimestamp(configuration.updatedAt)
}

function validatePreparedInput(input: InsertPreparedSyncTransportBatchInput): void {
  parseEntityId(input.id)
  parseUtcTimestamp(input.createdAt)
  if (
    typeof input.requestJson !== 'string' ||
    !sha256Pattern.test(input.requestSha256) ||
    createHash('sha256').update(input.requestJson).digest('hex') !== input.requestSha256 ||
    input.outboxIds.length === 0 ||
    input.outboxIds.length > 500 ||
    new Set(input.outboxIds).size !== input.outboxIds.length
  ) {
    throw new RepositoryValidationError()
  }
  try {
    JSON.parse(input.requestJson)
  } catch {
    throw new RepositoryValidationError()
  }
  input.outboxIds.forEach(parseEntityId)
}

function validateClaimInput(input: ClaimSyncTransportBatchInput): void {
  parseEntityId(input.batchId)
  parseEntityId(input.attemptId)
  const startedAt = parseUtcTimestamp(input.startedAt)
  const expiresAt = parseUtcTimestamp(input.leaseExpiresAt)
  if (expiresAt <= startedAt) throw new RepositoryValidationError()
}

function validateRescheduleInput(input: RescheduleSyncTransportBatchInput): void {
  parseEntityId(input.batchId)
  const endedAt = parseUtcTimestamp(input.endedAt)
  const nextAttemptAt = parseUtcTimestamp(input.nextAttemptAt)
  if (nextAttemptAt < endedAt || !errorCodePattern.test(input.errorCode)) {
    throw new RepositoryValidationError()
  }
}

function readBatchForWrite(
  connection: DatabaseTransactionConnection,
  batchId: EntityId
): PreparedSyncTransportBatch {
  const row = connection
    .prepare<[string], BatchRow>(
      `SELECT id, request_json, request_sha256, status, attempt_count, created_at,
              next_attempt_at, lease_expires_at, active_attempt_id, last_error_code,
              completed_at
       FROM sync_transport_batches WHERE id = ?`
    )
    .get(batchId)
  if (row === undefined) throw new RepositoryWriteError()
  return decodeBatch(row)
}

function decodeBatch(row: BatchRow): PreparedSyncTransportBatch {
  if (
    typeof row.request_json !== 'string' ||
    typeof row.request_sha256 !== 'string' ||
    !sha256Pattern.test(row.request_sha256) ||
    createHash('sha256').update(row.request_json).digest('hex') !== row.request_sha256 ||
    typeof row.attempt_count !== 'number' ||
    !Number.isSafeInteger(row.attempt_count) ||
    row.attempt_count < 0
  ) {
    throw new RepositoryDataIntegrityError()
  }
  const status = parseStatus(row.status)
  const value = Object.freeze({
    id: parseEntityId(row.id),
    requestJson: row.request_json,
    requestSha256: row.request_sha256,
    status,
    attemptCount: row.attempt_count,
    createdAt: parseUtcTimestamp(row.created_at),
    nextAttemptAt: parseNullableTimestamp(row.next_attempt_at),
    leaseExpiresAt: parseNullableTimestamp(row.lease_expires_at),
    activeAttemptId: row.active_attempt_id === null ? null : parseEntityId(row.active_attempt_id),
    lastErrorCode: row.last_error_code === null ? null : parseErrorCode(row.last_error_code),
    completedAt: parseNullableTimestamp(row.completed_at)
  })
  validateBatchState(value)
  return value
}

function parseStatus(value: unknown): SyncTransportBatchStatus {
  if (!['PREPARED', 'IN_FLIGHT', 'RETRY_WAIT', 'COMPLETED'].includes(String(value))) {
    throw new RepositoryDataIntegrityError()
  }
  return value as SyncTransportBatchStatus
}

function parseNullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null ? null : parseUtcTimestamp(value)
}

function parseErrorCode(value: unknown): string {
  if (typeof value !== 'string' || !errorCodePattern.test(value)) {
    throw new RepositoryDataIntegrityError()
  }
  return value
}

function validateBatchState(batch: PreparedSyncTransportBatch): void {
  if (
    (batch.status === 'PREPARED' &&
      (batch.nextAttemptAt !== null ||
        batch.leaseExpiresAt !== null ||
        batch.activeAttemptId !== null)) ||
    (batch.status === 'IN_FLIGHT' &&
      (batch.nextAttemptAt !== null ||
        batch.leaseExpiresAt === null ||
        batch.activeAttemptId === null)) ||
    (batch.status === 'RETRY_WAIT' &&
      (batch.nextAttemptAt === null ||
        batch.leaseExpiresAt !== null ||
        batch.activeAttemptId !== null)) ||
    (batch.status === 'COMPLETED' &&
      (batch.nextAttemptAt !== null ||
        batch.leaseExpiresAt !== null ||
        batch.activeAttemptId !== null ||
        batch.completedAt === null)) ||
    (batch.status !== 'COMPLETED' && batch.completedAt !== null)
  ) {
    throw new RepositoryDataIntegrityError()
  }
}

function throwWriteError(error: unknown): never {
  if (
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryWriteError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof DatabaseTransactionStateError
  ) {
    throw error
  }
  throw new RepositoryWriteError(getRepositoryErrorType(error))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
