import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createInstallationLocationConfigurationRepository,
  createSyncTransportBatchRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import { createSyncAdministrationService } from './sync-administration-service'
import type { SyncAdministrationService } from './sync-administration-types'
import type { SyncCredentialProtector } from './sync-transport-types'
import type { SyncWorkerMonitor } from './sync-worker-monitor'

export interface ProductionSyncAdministrationServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly credentialProtector: SyncCredentialProtector
  readonly workerMonitor?: SyncWorkerMonitor
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionSyncAdministrationService({
  connection,
  authenticationSessionService,
  credentialProtector,
  logger,
  workerMonitor
}: ProductionSyncAdministrationServiceOptions): SyncAdministrationService {
  return createSyncAdministrationService({
    authenticationSessionService,
    repository: createSyncTransportBatchRepository(connection),
    installationRepository: createInstallationRepository(connection),
    getEnrollmentDetails: () => {
      const installation = createInstallationRepository(connection).get()
      const configuration = createInstallationLocationConfigurationRepository(connection).get()
      if (!installation || !configuration || configuration.installationId !== installation.id)
        return null
      const location = createLocationRepository(connection).getById(configuration.locationId)
      if (!location) return null
      return Object.freeze({
        installationId: installation.id,
        sourceLocationId: location.id,
        deploymentName: installation.deploymentName,
        locationName: location.name,
        timezone: installation.timeZone
      })
    },
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    }),
    credentialProtector,
    workerMonitor
  })
}
