import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocalUserRepository,
  createLocationRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'
import { createPasswordCredentialService } from '@main/security'

import { createFirstRunBootstrapService } from './first-run-bootstrap-service'
import type { FirstRunBootstrapService } from './first-run-types'

export interface ProductionFirstRunBootstrapServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionFirstRunBootstrapService({
  connection,
  logger
}: ProductionFirstRunBootstrapServiceOptions): FirstRunBootstrapService {
  return createFirstRunBootstrapService({
    installationRepository: createInstallationRepository(connection),
    localUserRepository: createLocalUserRepository(connection),
    locationRepository: createLocationRepository(connection),
    installationLocationConfigurationRepository:
      createInstallationLocationConfigurationRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    passwordCredentialService: createPasswordCredentialService(),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
