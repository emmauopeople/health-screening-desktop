import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createPatientRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createScreeningEncounterStartService } from './screening-encounter-start-service'
import type { ScreeningEncounterStartService } from './screening-encounter-start-service-types'
import type { LocalAuthenticationSessionService } from '../authentication/session'

export interface ProductionScreeningEncounterStartServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningEncounterStartService({
  connection,
  authenticationSessionService,
  logger
}: ProductionScreeningEncounterStartServiceOptions): ScreeningEncounterStartService {
  return createScreeningEncounterStartService({
    authenticationSessionService,
    installationRepository: createInstallationRepository(connection),
    patientRepository: createPatientRepository(connection),
    locationRepository: createLocationRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
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
