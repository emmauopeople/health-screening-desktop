import type { SyncSnapshotRepository, SyncTransportBatchRepository } from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'

export type PrepareNextSyncBatchResult =
  | {
      readonly status: 'PREPARED'
      readonly batchId: EntityId
      readonly requestSha256: string
      readonly recordCount: number
      readonly signalCount: number
    }
  | { readonly status: 'IDLE' | 'UNAVAILABLE' }

export interface SyncSnapshotPreparationService {
  prepareNextBatch(): PrepareNextSyncBatchResult
}

export interface SyncSnapshotPreparationServiceDependencies {
  readonly snapshotRepository: SyncSnapshotRepository
  readonly batchRepository: SyncTransportBatchRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly desktopApplicationVersion: string
  readonly desktopSchemaVersion: number
}
