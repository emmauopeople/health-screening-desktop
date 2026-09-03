import {
  createCanonicalBatchRequest,
  parsePrepareSyncBatchInput
} from './sync-transport-validation'
import type {
  PrepareNextSyncBatchResult,
  SyncSnapshotPreparationService,
  SyncSnapshotPreparationServiceDependencies
} from './sync-snapshot-preparation-types'

export function createSyncSnapshotPreparationService({
  snapshotRepository,
  batchRepository,
  transactionExecutor,
  desktopApplicationVersion,
  desktopSchemaVersion
}: SyncSnapshotPreparationServiceDependencies): SyncSnapshotPreparationService {
  return Object.freeze({
    prepareNextBatch(): PrepareNextSyncBatchResult {
      try {
        return transactionExecutor.run((context) => {
          const source = snapshotRepository.materializeNext(context.connection, context.nowUtc())
          if (source === null) return statusResult('IDLE')

          const input = parsePrepareSyncBatchInput({
            ...source,
            desktopApplicationVersion,
            desktopSchemaVersion
          })
          const batchId = context.newEntityId()
          const createdAt = context.nowUtc()
          const canonical = createCanonicalBatchRequest(input, batchId, createdAt)
          batchRepository.insertPrepared(context.connection, {
            id: batchId,
            requestJson: canonical.json,
            requestSha256: canonical.sha256,
            createdAt,
            outboxIds: input.outboxIds
          })

          return Object.freeze({
            status: 'PREPARED' as const,
            batchId,
            requestSha256: canonical.sha256,
            recordCount: input.records.length,
            signalCount: input.outboxIds.length
          })
        })
      } catch {
        return statusResult('UNAVAILABLE')
      }
    }
  })
}

function statusResult<T extends 'IDLE' | 'UNAVAILABLE'>(status: T): Readonly<{ status: T }> {
  return Object.freeze({ status })
}
