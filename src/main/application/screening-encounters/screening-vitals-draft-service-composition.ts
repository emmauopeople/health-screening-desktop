import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  createScreeningVitalsDraftRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createScreeningVitalsDraftService } from './screening-vitals-draft-service'
import type { ScreeningVitalsDraftService } from './screening-vitals-draft-service-types'
import type { InstallationLocationService } from '../installation-location'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface ProductionScreeningVitalsDraftServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningVitalsDraftService({
  connection,
  authenticationSessionService,
  currentScreeningSessionService,
  installationLocationService,
  logger
}: ProductionScreeningVitalsDraftServiceOptions): ScreeningVitalsDraftService {
  return createScreeningVitalsDraftService({
    authenticationSessionService,
    currentScreeningSessionService,
    installationLocationService,
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    screeningVitalsDraftRepository: createScreeningVitalsDraftRepository(connection),
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
