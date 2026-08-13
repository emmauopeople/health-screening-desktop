import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLifestyleRepository,
  createLocationRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createScreeningLifestyleService } from './screening-lifestyle-service'
import type { ScreeningLifestyleService } from './screening-lifestyle-service-types'
import type { InstallationLocationService } from '../installation-location'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface ProductionScreeningLifestyleServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningLifestyleService({
  connection,
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  logger
}: ProductionScreeningLifestyleServiceOptions): ScreeningLifestyleService {
  return createScreeningLifestyleService({
    authenticationSessionService,
    currentScreeningSessionService,
    installationLocationService,
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    lifestyleRepository: createLifestyleRepository(connection),
    screeningEncounterOutboxRepository: createScreeningEncounterOutboxRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
