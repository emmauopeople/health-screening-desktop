import type Database from 'better-sqlite3'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createScreeningEncounterManagementRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'
import { createScreeningEncounterManagementService } from './screening-encounter-management-service'
import type { ScreeningEncounterManagementService } from './screening-encounter-management-service-types'

export function createProductionScreeningEncounterManagementService(options: {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationLocationService: InstallationLocationService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly logger?: DatabaseTransactionLogger
}): ScreeningEncounterManagementService {
  const {
    connection,
    authenticationSessionService,
    installationLocationService,
    currentScreeningSessionService,
    logger
  } = options
  return createScreeningEncounterManagementService({
    authenticationSessionService,
    installationLocationService,
    currentScreeningSessionService,
    installationRepository: createInstallationRepository(connection),
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    managementRepository: createScreeningEncounterManagementRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    screeningEncounterOutboxRepository: createScreeningEncounterOutboxRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
