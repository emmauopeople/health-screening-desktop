import type Database from 'better-sqlite3'

import {
  createDatabaseTransactionExecutor,
  createSyncSnapshotRepository,
  createSyncTransportBatchRepository,
  createSyncWorkerRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createSyncHttpClient, type SyncHttpClientOptions } from './sync-http-client'
import { createSyncSnapshotPreparationService } from './sync-snapshot-preparation-service'
import { createSyncTransportFoundationService } from './sync-transport-service'
import type { SyncCredentialProtector } from './sync-transport-types'
import { createSyncWorkerService, type SyncWorkerService } from './sync-worker-service'

export interface ProductionSyncWorkerServiceOptions {
  readonly connection: Database.Database
  readonly desktopApplicationVersion: string
  readonly desktopSchemaVersion: number
  readonly credentialProtector: SyncCredentialProtector
  readonly httpClientOptions?: SyncHttpClientOptions
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionSyncWorkerService({
  connection,
  desktopApplicationVersion,
  desktopSchemaVersion,
  credentialProtector,
  httpClientOptions,
  logger
}: ProductionSyncWorkerServiceOptions): SyncWorkerService {
  const transactionExecutor = createDatabaseTransactionExecutor({
    connection,
    idGenerator: createSystemEntityIdGenerator(),
    clock: createSystemUtcClock(),
    logger
  })
  const batchRepository = createSyncTransportBatchRepository(connection)
  return createSyncWorkerService({
    foundation: createSyncTransportFoundationService({
      repository: batchRepository,
      transactionExecutor,
      credentialProtector
    }),
    preparation: createSyncSnapshotPreparationService({
      snapshotRepository: createSyncSnapshotRepository(connection),
      batchRepository,
      transactionExecutor,
      desktopApplicationVersion,
      desktopSchemaVersion
    }),
    httpClient: createSyncHttpClient(httpClientOptions),
    repository: createSyncWorkerRepository(),
    transactionExecutor
  })
}

export interface SyncWorkerScheduler {
  start(): void
  stop(): void
}

export function createSyncWorkerScheduler(
  worker: SyncWorkerService,
  intervalMs = 5 * 60_000
): SyncWorkerScheduler {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10_000) {
    throw new Error('Invalid synchronization interval.')
  }
  let timer: ReturnType<typeof setInterval> | null = null
  const run = (): void => {
    void worker.runOnce()
  }
  return Object.freeze({
    start(): void {
      if (timer !== null) return
      run()
      timer = setInterval(run, intervalMs)
      timer.unref()
    },
    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }
  })
}
