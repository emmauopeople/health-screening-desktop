import type { SyncWorkerRepository } from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { parseSyncBatchResponse, parseSyncProblem, type SyncBatchResponse } from './sync-contract'
import type { SyncHttpClient, SyncHttpResult } from './sync-http-client'
import type { SyncSnapshotPreparationService } from './sync-snapshot-preparation-types'
import { addMilliseconds } from './sync-transport-validation'
import type { SyncTransportFoundationService } from './sync-transport-types'

const maximumRetryMs = 15 * 60_000
const permanentFailureRetryMs = 24 * 60 * 60_000

export type SyncWorkerRunResult =
  | Readonly<{
      status: 'SYNCED'
      batchId: EntityId
      recordCount: number
    }>
  | Readonly<{ status: 'IDLE' }>
  | Readonly<{ status: 'RETRY_SCHEDULED'; batchId: EntityId; errorCode: string }>
  | Readonly<{ status: 'NOT_CONFIGURED' | 'BUSY' | 'UNAVAILABLE' }>

export interface SyncWorkerService {
  runOnce(): Promise<SyncWorkerRunResult>
}

export interface SyncWorkerServiceDependencies {
  readonly foundation: SyncTransportFoundationService
  readonly preparation: SyncSnapshotPreparationService
  readonly httpClient: SyncHttpClient
  readonly repository: SyncWorkerRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly random?: () => number
}

export function createSyncWorkerService(
  dependencies: SyncWorkerServiceDependencies
): SyncWorkerService {
  const random = dependencies.random ?? Math.random
  let running = false
  return Object.freeze({
    async runOnce(): Promise<SyncWorkerRunResult> {
      if (running) return Object.freeze({ status: 'BUSY' as const })
      running = true
      try {
        return await runWorker(dependencies, random)
      } catch {
        return Object.freeze({ status: 'UNAVAILABLE' as const })
      } finally {
        running = false
      }
    }
  })
}

async function runWorker(
  dependencies: SyncWorkerServiceDependencies,
  random: () => number
): Promise<SyncWorkerRunResult> {
  dependencies.foundation.recoverExpiredLeases()
  const credential = dependencies.foundation.loadCredentialForTransport()
  if (credential === null) return Object.freeze({ status: 'NOT_CONFIGURED' as const })

  let claimed = dependencies.foundation.claimNextBatch()
  if (claimed.status === 'IDLE') {
    const prepared = dependencies.preparation.prepareNextBatch()
    if (prepared.status === 'PREPARED') {
      claimed = dependencies.foundation.claimNextBatch()
    } else if (prepared.status === 'UNAVAILABLE') {
      return Object.freeze({ status: 'UNAVAILABLE' as const })
    }
  }
  if (claimed.status !== 'CLAIMED') {
    if (claimed.status === 'UNAVAILABLE') return Object.freeze({ status: 'UNAVAILABLE' as const })
    return Object.freeze({ status: 'IDLE' as const })
  }
  const activeClaim = claimed as Extract<
    ReturnType<SyncTransportFoundationService['claimNextBatch']>,
    { status: 'CLAIMED' }
  >

  let response =
    activeClaim.attemptCount > 1
      ? await dependencies.httpClient.recoverBatch(credential, activeClaim.batchId)
      : await dependencies.httpClient.submitBatch(credential, activeClaim.requestJson)
  if (
    activeClaim.attemptCount > 1 &&
    response.status === 'RESPONSE' &&
    response.httpStatus === 404
  ) {
    response = await dependencies.httpClient.submitBatch(credential, activeClaim.requestJson)
  }

  if (response.status !== 'RESPONSE' || response.httpStatus !== 200) {
    return scheduleRetry(dependencies.foundation, activeClaim, response, random)
  }

  let parsed: SyncBatchResponse
  try {
    parsed = parseSyncBatchResponse(response.bodyText, activeClaim.requestJson)
  } catch {
    return scheduleRetry(
      dependencies.foundation,
      activeClaim,
      Object.freeze({
        status: 'RESPONSE' as const,
        httpStatus: 502,
        bodyText: '',
        retryAfterMs: null
      }),
      random,
      'INVALID_SYNC_RESPONSE'
    )
  }

  dependencies.transactionExecutor.run((context) => {
    const completedAt = context.nowUtc()
    dependencies.repository.completeBatch(context.connection, {
      response: parsed,
      responseJson: response.bodyText,
      completedAt,
      retryAt: parseUtcTimestamp(
        addMilliseconds(completedAt, retryDelay(activeClaim.attemptCount, random))
      )
    })
  })

  return Object.freeze({
    status: 'SYNCED' as const,
    batchId: activeClaim.batchId,
    recordCount: parsed.outcomes.length
  })
}

function scheduleRetry(
  foundation: SyncTransportFoundationService,
  claimed: Extract<
    ReturnType<SyncTransportFoundationService['claimNextBatch']>,
    { status: 'CLAIMED' }
  >,
  response: SyncHttpResult,
  random: () => number,
  overrideErrorCode?: string
): SyncWorkerRunResult {
  const problem = response.status === 'RESPONSE' ? parseSyncProblem(response.bodyText) : null
  const errorCode =
    overrideErrorCode ??
    (response.status === 'TRANSPORT_ERROR'
      ? response.errorCode
      : (problem?.code ?? `HTTP_${response.httpStatus}`))
  const permanentHttpFailure =
    response.status === 'RESPONSE' && [400, 401, 403, 413].includes(response.httpStatus)
  const delay =
    response.status === 'RESPONSE' && response.retryAfterMs !== null
      ? Math.max(response.retryAfterMs, 1_000)
      : permanentHttpFailure
        ? permanentFailureRetryMs
        : retryDelay(claimed.attemptCount, random)
  const scheduled = foundation.scheduleRetry({
    batchId: claimed.batchId,
    errorCode: sanitizeErrorCode(errorCode),
    retryAfterMs: delay
  })
  return scheduled.status === 'RETRY_SCHEDULED'
    ? Object.freeze({
        status: 'RETRY_SCHEDULED' as const,
        batchId: claimed.batchId,
        errorCode: sanitizeErrorCode(errorCode)
      })
    : Object.freeze({ status: 'UNAVAILABLE' as const })
}

function retryDelay(attemptCount: number, random: () => number): number {
  const base = Math.min(5_000 * 2 ** Math.max(0, attemptCount - 1), maximumRetryMs)
  const jitter = 0.75 + Math.min(Math.max(random(), 0), 1) * 0.5
  return Math.max(1_000, Math.min(Math.floor(base * jitter), maximumRetryMs))
}

function sanitizeErrorCode(value: string): string {
  return /^[A-Z0-9_]{1,64}$/.test(value) ? value : 'TRANSPORT_FAILURE'
}
