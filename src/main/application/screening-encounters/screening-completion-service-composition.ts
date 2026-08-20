import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createFoodRepository,
  createInstallationRepository,
  createLifestyleRepository,
  createLocationRepository,
  createOtcRepository,
  createScreeningEncounterCompletionRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  createScreeningVitalsDraftRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createScreeningCompletionService } from './screening-completion-service'
import type { ScreeningCompletionService } from './screening-completion-service-types'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface ProductionScreeningCompletionServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningCompletionService({
  connection,
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  logger
}: ProductionScreeningCompletionServiceOptions): ScreeningCompletionService {
  return createScreeningCompletionService({
    authenticationSessionService,
    currentScreeningSessionService,
    installationLocationService,
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    screeningVitalsDraftRepository: createScreeningVitalsDraftRepository(connection),
    lifestyleRepository: createLifestyleRepository(connection),
    foodRepository: createFoodRepository(connection),
    otcRepository: createOtcRepository(connection),
    completionRepository: createScreeningEncounterCompletionRepository(connection),
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
