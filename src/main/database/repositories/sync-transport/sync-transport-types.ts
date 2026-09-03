import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type SyncTransportBatchStatus = 'PREPARED' | 'IN_FLIGHT' | 'RETRY_WAIT' | 'COMPLETED'

export interface StoredSyncTransportConfiguration {
  readonly apiBaseUrl: string
  readonly protectedToken: string
  readonly tokenPrefix: string
  readonly updatedAt: UtcTimestamp
}

export interface PreparedSyncTransportBatch {
  readonly id: EntityId
  readonly requestJson: string
  readonly requestSha256: string
  readonly status: SyncTransportBatchStatus
  readonly attemptCount: number
  readonly createdAt: UtcTimestamp
  readonly nextAttemptAt: UtcTimestamp | null
  readonly leaseExpiresAt: UtcTimestamp | null
  readonly activeAttemptId: EntityId | null
  readonly lastErrorCode: string | null
  readonly completedAt: UtcTimestamp | null
}

export interface InsertPreparedSyncTransportBatchInput {
  readonly id: EntityId
  readonly requestJson: string
  readonly requestSha256: string
  readonly createdAt: UtcTimestamp
  readonly outboxIds: readonly EntityId[]
}

export interface ClaimSyncTransportBatchInput {
  readonly batchId: EntityId
  readonly attemptId: EntityId
  readonly startedAt: UtcTimestamp
  readonly leaseExpiresAt: UtcTimestamp
}

export interface RescheduleSyncTransportBatchInput {
  readonly batchId: EntityId
  readonly endedAt: UtcTimestamp
  readonly nextAttemptAt: UtcTimestamp
  readonly errorCode: string
  readonly attemptStatus: 'RETRY_SCHEDULED' | 'LEASE_EXPIRED'
}

export interface SyncTransportBatchRepository {
  getConfiguration(): StoredSyncTransportConfiguration | null
  upsertConfiguration(
    connection: DatabaseTransactionConnection,
    configuration: StoredSyncTransportConfiguration
  ): void
  insertPrepared(
    connection: DatabaseTransactionConnection,
    input: InsertPreparedSyncTransportBatchInput
  ): PreparedSyncTransportBatch
  findReadyForWrite(
    connection: DatabaseTransactionConnection,
    now: UtcTimestamp
  ): PreparedSyncTransportBatch | null
  claim(
    connection: DatabaseTransactionConnection,
    input: ClaimSyncTransportBatchInput
  ): PreparedSyncTransportBatch
  reschedule(
    connection: DatabaseTransactionConnection,
    input: RescheduleSyncTransportBatchInput
  ): PreparedSyncTransportBatch
  recoverExpired(
    connection: DatabaseTransactionConnection,
    now: UtcTimestamp,
    nextAttemptAt: UtcTimestamp
  ): number
}
