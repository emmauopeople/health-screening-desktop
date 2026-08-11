import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import { createInstallationLocationService } from './installation-location-service'
import type { InstallationLocationService } from './installation-location-service-types'

export interface ProductionInstallationLocationServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionInstallationLocationService({
  connection,
  authenticationSessionService,
  logger
}: ProductionInstallationLocationServiceOptions): InstallationLocationService {
  return createInstallationLocationService({
    authenticationSessionService,
    installationRepository: createInstallationRepository(connection),
    installationLocationConfigurationRepository:
      createInstallationLocationConfigurationRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
