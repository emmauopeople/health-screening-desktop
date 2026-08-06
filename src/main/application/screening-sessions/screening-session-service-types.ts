import type {
  AuditEventRepository,
  InstallationRepository,
  LocalUserRole,
  LocationRepository,
  ProtocolVersionRepository,
  ScreeningSessionDate,
  ScreeningSessionListInput,
  ScreeningSessionListResult,
  ScreeningSessionOutboxRepository,
  ScreeningSessionRecord,
  ScreeningSessionRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'

export interface ScreeningSessionServiceActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

export interface CreateScreeningSessionRequest {
  readonly locationId: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly notes: string | null
}

export interface CloseScreeningSessionRequest {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly reason?: string | null
}

export interface ReopenScreeningSessionRequest {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly reason: string
}

export interface GetScreeningSessionRequest {
  readonly id: EntityId
}

export type ListScreeningSessionsRequest = ScreeningSessionListInput

export type CreateScreeningSessionResult =
  | {
      readonly status: 'CREATED'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'ALREADY_EXISTS'
    }
  | {
      readonly status: 'SESSION_DATE_NOT_CURRENT'
    }
  | {
      readonly status: 'LOCATION_NOT_FOUND'
    }
  | {
      readonly status: 'LOCATION_INACTIVE'
    }
  | {
      readonly status: 'NO_ACTIVE_PROTOCOL'
    }

export type CloseScreeningSessionResult =
  | {
      readonly status: 'CLOSED'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'NOT_FOUND'
    }
  | {
      readonly status: 'SESSION_VERSION_CONFLICT'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'ALREADY_CLOSED'
      readonly session: ScreeningSessionRecord
    }

export type ReopenScreeningSessionResult =
  | {
      readonly status: 'REOPENED'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'NOT_FOUND'
    }
  | {
      readonly status: 'SESSION_VERSION_CONFLICT'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'ALREADY_OPEN'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'FORBIDDEN'
    }

export type GetScreeningSessionResult =
  | {
      readonly status: 'FOUND'
      readonly session: ScreeningSessionRecord
    }
  | {
      readonly status: 'NOT_FOUND'
    }

export type ListScreeningSessionsResult = ScreeningSessionListResult & {
  readonly status: 'LISTED'
}

export interface ScreeningSessionService {
  create(
    request: CreateScreeningSessionRequest,
    actor: ScreeningSessionServiceActor
  ): CreateScreeningSessionResult

  close(
    request: CloseScreeningSessionRequest,
    actor: ScreeningSessionServiceActor
  ): CloseScreeningSessionResult

  reopen(
    request: ReopenScreeningSessionRequest,
    actor: ScreeningSessionServiceActor
  ): ReopenScreeningSessionResult

  getById(
    request: GetScreeningSessionRequest,
    actor: ScreeningSessionServiceActor
  ): GetScreeningSessionResult

  list(
    request: ListScreeningSessionsRequest,
    actor: ScreeningSessionServiceActor
  ): ListScreeningSessionsResult
}

export interface ScreeningSessionServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly protocolVersionRepository: ProtocolVersionRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningSessionOutboxRepository: ScreeningSessionOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
