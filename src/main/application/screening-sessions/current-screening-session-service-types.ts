import type {
  AuditEventRepository,
  InstallationRepository,
  LocationName,
  LocationRepository,
  ProtocolVersionRepository,
  ScreeningSessionDate,
  ScreeningSessionOutboxRepository,
  ScreeningSessionRecord,
  ScreeningSessionRepository
} from '@main/database'
import type {
  DatabaseTransactionConnection,
  DatabaseTransactionExecutor
} from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'

export interface CurrentScreeningSessionLocation {
  readonly id: EntityId
  readonly displayName: LocationName
}

export interface CurrentScreeningSessionSummary {
  readonly id: EntityId
  readonly locationId: EntityId
  readonly protocolVersionId: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly status: 'OPEN'
  readonly notes: null
  readonly openedAt: ScreeningSessionRecord['openedAt']
  readonly closedAt: null
  readonly createdAt: ScreeningSessionRecord['createdAt']
  readonly rowVersion: number
}

export type EnsureCurrentScreeningSessionResult =
  | {
      readonly status: 'RESOLVED' | 'CREATED'
      readonly session: CurrentScreeningSessionSummary
      readonly location: CurrentScreeningSessionLocation
    }
  | {
      readonly status:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'LOCATION_NOT_CONFIGURED'
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
        | 'SESSION_CLOSED'
        | 'SESSION_CONFLICT'
        | 'NO_ACTIVE_PROTOCOL'
        | 'UNAVAILABLE'
    }

export type FindCurrentScreeningSessionResult =
  | {
      readonly status: 'FOUND'
      readonly session: CurrentScreeningSessionSummary
      readonly location: CurrentScreeningSessionLocation
    }
  | {
      readonly status:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'LOCATION_NOT_CONFIGURED'
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
        | 'SESSION_NOT_FOUND'
        | 'SESSION_CLOSED'
        | 'UNAVAILABLE'
    }

export interface CurrentScreeningSessionTransactionInput {
  readonly connection: DatabaseTransactionConnection
  readonly occurredAt: UtcTimestamp
}

export interface CurrentScreeningSessionService {
  ensureCurrentScreeningSession(): EnsureCurrentScreeningSessionResult
  findCurrentScreeningSession(): FindCurrentScreeningSessionResult
  findCurrentScreeningSessionInTransaction(
    input: CurrentScreeningSessionTransactionInput
  ): FindCurrentScreeningSessionResult
}

export interface CurrentScreeningSessionServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly protocolVersionRepository: ProtocolVersionRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningSessionOutboxRepository: ScreeningSessionOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
