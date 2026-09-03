import type { SyncTransportBatchRepository } from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type SyncResourceType =
  'PATIENT' | 'SCREENING_SESSION' | 'SCREENING_ENCOUNTER' | 'VITALS' | 'LIFESTYLE'

export type SyncJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly SyncJsonValue[]
  | Readonly<{ [key: string]: SyncJsonValue }>

export interface SyncSourceActorSnapshot {
  readonly localActorId: EntityId
  readonly displayName: string
  readonly role: 'LOCAL_ADMIN' | 'NURSE' | 'TRAINED_SCREENER'
  readonly active: boolean
  readonly updatedAt: UtcTimestamp
}

export interface SyncRecordSnapshot {
  readonly recordId: EntityId
  readonly resourceType: SyncResourceType
  readonly localResourceId: EntityId
  readonly sourceRevision: number
  readonly schemaVersion:
    'patient.v1' | 'screening-session.v1' | 'screening-encounter.v1' | 'vitals.v1' | 'lifestyle.v1'
  readonly operation: 'UPSERT'
  readonly capturedAt: UtcTimestamp
  readonly sourceActorLocalId: EntityId
  readonly payload: Readonly<{ [key: string]: SyncJsonValue }>
}

export interface PrepareSyncBatchInput {
  readonly installationId: EntityId
  readonly locationId: EntityId
  readonly installationTimezone: string
  readonly desktopApplicationVersion: string
  readonly desktopSchemaVersion: number
  readonly actors: readonly SyncSourceActorSnapshot[]
  readonly records: readonly SyncRecordSnapshot[]
  readonly outboxIds: readonly EntityId[]
}

export type PrepareSyncBatchResult =
  | {
      readonly status: 'PREPARED'
      readonly batchId: EntityId
      readonly requestSha256: string
      readonly recordCount: number
      readonly signalCount: number
    }
  | { readonly status: 'VALIDATION_FAILED' | 'UNAVAILABLE' }

export type ClaimSyncBatchResult =
  | {
      readonly status: 'CLAIMED'
      readonly batchId: EntityId
      readonly attemptId: EntityId
      readonly requestJson: string
      readonly requestSha256: string
      readonly attemptCount: number
      readonly leaseExpiresAt: UtcTimestamp
    }
  | { readonly status: 'IDLE' | 'UNAVAILABLE' }

export type RescheduleSyncBatchResult =
  | {
      readonly status: 'RETRY_SCHEDULED'
      readonly batchId: EntityId
      readonly nextAttemptAt: UtcTimestamp
    }
  | { readonly status: 'VALIDATION_FAILED' | 'UNAVAILABLE' }

export type ConfigureSyncTransportResult =
  | {
      readonly status: 'CONFIGURED'
      readonly apiBaseUrl: string
      readonly tokenPrefix: string
      readonly updatedAt: UtcTimestamp
    }
  | { readonly status: 'PROTECTION_UNAVAILABLE' | 'VALIDATION_FAILED' | 'UNAVAILABLE' }

export type SyncTransportConfigurationState =
  | { readonly status: 'NOT_CONFIGURED' | 'UNAVAILABLE' }
  | {
      readonly status: 'CONFIGURED'
      readonly apiBaseUrl: string
      readonly tokenPrefix: string
      readonly updatedAt: UtcTimestamp
    }

export interface SyncTransportCredential {
  readonly apiBaseUrl: string
  readonly installationToken: string
}

export interface SyncCredentialProtector {
  isAvailable(): boolean
  protect(secret: string): Uint8Array
  unprotect(ciphertext: Uint8Array): string
}

export interface SyncTransportFoundationService {
  configure(request: unknown): ConfigureSyncTransportResult
  getConfigurationState(): SyncTransportConfigurationState
  loadCredentialForTransport(): SyncTransportCredential | null
  prepareBatch(request: unknown): PrepareSyncBatchResult
  claimNextBatch(leaseDurationMs?: number): ClaimSyncBatchResult
  scheduleRetry(request: unknown): RescheduleSyncBatchResult
  recoverExpiredLeases(): number
}

export interface SyncTransportFoundationServiceDependencies {
  readonly repository: SyncTransportBatchRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly credentialProtector: SyncCredentialProtector
}
