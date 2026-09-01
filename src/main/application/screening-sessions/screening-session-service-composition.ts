import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createProtocolVersionRepository,
  createScreeningEncounterRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  createScreeningSessionSummaryRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import { createInstallationLocationService } from '../installation-location'
import { createCurrentScreeningSessionService } from './current-screening-session-service'
import type { CurrentScreeningSessionService } from './current-screening-session-service-types'
import { createScreeningSessionService } from './screening-session-service'
import type { ScreeningSessionService } from './screening-session-service-types'
import { createScreeningSessionWorkspaceContextService } from './screening-session-workspace-context-service'
import type { ScreeningSessionWorkspaceContextService } from './screening-session-workspace-context-types'

export interface ProductionScreeningSessionServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionScreeningSessionService({
  connection,
  logger
}: ProductionScreeningSessionServiceOptions): ScreeningSessionService {
  return createScreeningSessionService({
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    protocolVersionRepository: createProtocolVersionRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningSessionSummaryRepository: createScreeningSessionSummaryRepository(connection),
    screeningSessionOutboxRepository: createScreeningSessionOutboxRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}

export interface ProductionCurrentScreeningSessionServiceOptions {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionCurrentScreeningSessionService({
  connection,
  authenticationSessionService,
  logger
}: ProductionCurrentScreeningSessionServiceOptions): CurrentScreeningSessionService {
  const installationRepository = createInstallationRepository(connection)
  const locationRepository = createLocationRepository(connection)
  const screeningSessionRepository = createScreeningSessionRepository(connection)
  const auditEventRepository = createAuditEventRepository(connection)
  const installationLocationService = createInstallationLocationService({
    authenticationSessionService,
    installationRepository,
    installationLocationConfigurationRepository:
      createInstallationLocationConfigurationRepository(connection),
    locationRepository,
    screeningSessionRepository,
    screeningEncounterRepository: createScreeningEncounterRepository(connection),
    auditEventRepository,
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })

  return createCurrentScreeningSessionService({
    authenticationSessionService,
    installationLocationService,
    installationRepository,
    locationRepository,
    protocolVersionRepository: createProtocolVersionRepository(connection),
    screeningSessionRepository,
    screeningSessionOutboxRepository: createScreeningSessionOutboxRepository(connection),
    auditEventRepository,
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}

export interface ProductionScreeningSessionWorkspaceContextServiceOptions {
  readonly connection: Database.Database
}

export function createProductionScreeningSessionWorkspaceContextService({
  connection
}: ProductionScreeningSessionWorkspaceContextServiceOptions): ScreeningSessionWorkspaceContextService {
  return createScreeningSessionWorkspaceContextService({
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    clock: createSystemUtcClock()
  })
}
