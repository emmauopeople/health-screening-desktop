import { Buffer } from 'node:buffer'

import type { EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import type {
  ClaimSyncBatchResult,
  ConfigureSyncTransportResult,
  PrepareSyncBatchResult,
  RescheduleSyncBatchResult,
  SyncTransportConfigurationState,
  SyncTransportCredential,
  SyncTransportFoundationService,
  SyncTransportFoundationServiceDependencies
} from './sync-transport-types'
import {
  addMilliseconds,
  createCanonicalBatchRequest,
  parsePrepareSyncBatchInput,
  parseRetryRequest,
  parseSyncConfiguration
} from './sync-transport-validation'

const defaultLeaseDurationMs = 60_000
const maximumLeaseDurationMs = 10 * 60_000
const recoveryDelayMs = 5_000

export function createSyncTransportFoundationService({
  repository,
  transactionExecutor,
  credentialProtector
}: SyncTransportFoundationServiceDependencies): SyncTransportFoundationService {
  return Object.freeze({
    configure(request: unknown): ConfigureSyncTransportResult {
      let parsed: ReturnType<typeof parseSyncConfiguration>
      try {
        parsed = parseSyncConfiguration(request)
      } catch {
        return result('VALIDATION_FAILED')
      }
      if (!credentialProtector.isAvailable()) return result('PROTECTION_UNAVAILABLE')
      try {
        const protectedToken = Buffer.from(
          credentialProtector.protect(parsed.installationToken)
        ).toString('base64')
        return transactionExecutor.run((context) => {
          const updatedAt = context.nowUtc()
          repository.upsertConfiguration(context.connection, {
            apiBaseUrl: parsed.apiBaseUrl,
            protectedToken,
            tokenPrefix: parsed.tokenPrefix,
            updatedAt
          })
          return Object.freeze({
            status: 'CONFIGURED' as const,
            apiBaseUrl: parsed.apiBaseUrl,
            tokenPrefix: parsed.tokenPrefix,
            updatedAt
          })
        })
      } catch {
        return result('UNAVAILABLE')
      }
    },

    getConfigurationState(): SyncTransportConfigurationState {
      try {
        const configuration = repository.getConfiguration()
        return configuration === null
          ? result('NOT_CONFIGURED')
          : Object.freeze({
              status: 'CONFIGURED' as const,
              apiBaseUrl: configuration.apiBaseUrl,
              tokenPrefix: configuration.tokenPrefix,
              updatedAt: configuration.updatedAt
            })
      } catch {
        return result('UNAVAILABLE')
      }
    },

    loadCredentialForTransport(): SyncTransportCredential | null {
      try {
        if (!credentialProtector.isAvailable()) return null
        const configuration = repository.getConfiguration()
        if (configuration === null) return null
        const installationToken = credentialProtector.unprotect(
          Buffer.from(configuration.protectedToken, 'base64')
        )
        const parsed = parseSyncConfiguration({
          apiBaseUrl: configuration.apiBaseUrl,
          installationToken
        })
        if (parsed.tokenPrefix !== configuration.tokenPrefix) return null
        return Object.freeze({
          apiBaseUrl: parsed.apiBaseUrl,
          installationToken: parsed.installationToken
        })
      } catch {
        return null
      }
    },

    prepareBatch(request: unknown): PrepareSyncBatchResult {
      let input: ReturnType<typeof parsePrepareSyncBatchInput>
      try {
        input = parsePrepareSyncBatchInput(request)
      } catch {
        return result('VALIDATION_FAILED')
      }
      try {
        return transactionExecutor.run((context) => {
          const batchId = context.newEntityId()
          const createdAt = context.nowUtc()
          const canonical = createCanonicalBatchRequest(input, batchId, createdAt)
          repository.insertPrepared(context.connection, {
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
        return result('UNAVAILABLE')
      }
    },

    claimNextBatch(leaseDurationMs = defaultLeaseDurationMs): ClaimSyncBatchResult {
      if (
        !Number.isSafeInteger(leaseDurationMs) ||
        leaseDurationMs < 1_000 ||
        leaseDurationMs > maximumLeaseDurationMs
      ) {
        return result('UNAVAILABLE')
      }
      try {
        return transactionExecutor.run((context) => {
          const startedAt = context.nowUtc()
          const batch = repository.findReadyForWrite(context.connection, startedAt)
          if (batch === null) return result('IDLE')
          const attemptId = context.newEntityId()
          const leaseExpiresAt = parseUtcTimestamp(addMilliseconds(startedAt, leaseDurationMs))
          const claimed = repository.claim(context.connection, {
            batchId: batch.id,
            attemptId,
            startedAt,
            leaseExpiresAt
          })
          return Object.freeze({
            status: 'CLAIMED' as const,
            batchId: claimed.id,
            attemptId,
            requestJson: claimed.requestJson,
            requestSha256: claimed.requestSha256,
            attemptCount: claimed.attemptCount,
            leaseExpiresAt
          })
        })
      } catch {
        return result('UNAVAILABLE')
      }
    },

    scheduleRetry(request: unknown): RescheduleSyncBatchResult {
      let input: ReturnType<typeof parseRetryRequest>
      try {
        input = parseRetryRequest(request)
      } catch {
        return result('VALIDATION_FAILED')
      }
      try {
        return transactionExecutor.run((context) => {
          const endedAt = context.nowUtc()
          const nextAttemptAt = parseUtcTimestamp(addMilliseconds(endedAt, input.retryAfterMs))
          repository.reschedule(context.connection, {
            batchId: input.batchId,
            endedAt,
            nextAttemptAt,
            errorCode: input.errorCode,
            attemptStatus: 'RETRY_SCHEDULED'
          })
          return Object.freeze({
            status: 'RETRY_SCHEDULED' as const,
            batchId: input.batchId,
            nextAttemptAt
          })
        })
      } catch {
        return result('UNAVAILABLE')
      }
    },

    recoverExpiredLeases(): number {
      try {
        return transactionExecutor.run((context) => {
          const now = context.nowUtc()
          const nextAttemptAt = parseUtcTimestamp(addMilliseconds(now, recoveryDelayMs))
          return repository.recoverExpired(context.connection, now, nextAttemptAt)
        })
      } catch {
        return 0
      }
    }
  })
}

function result<T extends string>(status: T): Readonly<{ status: T }> {
  return Object.freeze({ status })
}

export function sanitizeSyncErrorCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : 'TRANSPORT_FAILURE'
}

export function createRetryRequest(
  batchId: EntityId,
  errorCode: unknown,
  retryAfterMs: number
): Readonly<{ batchId: EntityId; errorCode: string; retryAfterMs: number }> {
  return Object.freeze({ batchId, errorCode: sanitizeSyncErrorCode(errorCode), retryAfterMs })
}

export type { UtcTimestamp }
