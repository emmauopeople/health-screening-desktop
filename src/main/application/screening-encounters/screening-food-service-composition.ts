import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createFoodRepository,
  createInstallationRepository,
  createLocationRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createScreeningFoodService } from './screening-food-service'
import type { ScreeningFoodService } from './screening-food-service-types'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface ProductionScreeningFoodServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningFoodService({
  connection,
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  logger
}: ProductionScreeningFoodServiceOptions): ScreeningFoodService {
  return createScreeningFoodService({
    authenticationSessionService,
    currentScreeningSessionService,
    installationLocationService,
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    foodRepository: createFoodRepository(connection),
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
