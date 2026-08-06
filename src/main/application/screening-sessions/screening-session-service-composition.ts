import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createProtocolVersionRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

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
