import type { SyncSnapshotDiagnostic } from '@shared/sync-snapshot-diagnostics'
import { SnapshotMaterializationError } from '@main/database/repositories/sync-snapshot/sync-snapshot-diagnostics'
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
  desktopSchemaVersion,
  onFailure
}: SyncSnapshotPreparationServiceDependencies): SyncSnapshotPreparationService {
  return Object.freeze({
    prepareNextBatch(): PrepareNextSyncBatchResult {
      let stage: SyncSnapshotDiagnostic['stage'] = 'TRANSACTION'
      let diagnostic: SyncSnapshotDiagnostic | undefined
      try {
        return transactionExecutor.run((context) => {
          try {
            stage = 'INSTALLATION'
            const source = snapshotRepository.materializeNext(context.connection, context.nowUtc())
            if (source === null) return statusResult('IDLE')

            stage = 'INPUT_VALIDATION'
            const input = parsePrepareSyncBatchInput({
              ...source,
              desktopApplicationVersion,
              desktopSchemaVersion
            })
            const batchId = context.newEntityId()
            const createdAt = context.nowUtc()
            stage = 'CANONICALIZATION'
            const canonical = createCanonicalBatchRequest(input, batchId, createdAt)
            stage = 'BATCH_INSERT'
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
          } catch (error) {
            diagnostic =
              error instanceof SnapshotMaterializationError
                ? error.diagnostic
                : { stage, rule: preparationFailureRule(stage, error) }
            throw error
          }
        })
      } catch {
        try {
          onFailure?.(diagnostic ?? { stage: 'TRANSACTION', rule: 'TRANSACTION_FAILED' })
        } catch {
          /* Diagnostics cannot change the outcome. */
        }
        return statusResult('UNAVAILABLE')
      }
    }
  })
}

function statusResult<T extends 'IDLE' | 'UNAVAILABLE'>(status: T): Readonly<{ status: T }> {
  return Object.freeze({ status })
}

function preparationFailureRule(
  stage: SyncSnapshotDiagnostic['stage'],
  error: unknown
): SyncSnapshotDiagnostic['rule'] {
  // Match only constant messages from our canonical serializer; never forward a message.
  if (stage === 'CANONICALIZATION' && error instanceof Error) {
    if (error.message === 'json bounds exceeded') return 'JSON_BOUNDS'
    if (error.message === 'sync batch too large') return 'BATCH_BYTES'
  }
  return stage === 'BATCH_INSERT' ? 'BATCH_WRITE' : 'INPUT_INVALID'
}
