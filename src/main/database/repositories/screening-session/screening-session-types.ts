import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningSessionStatus = 'OPEN' | 'CLOSED'

export type ScreeningSessionLifecycleTransition = 'CREATED' | 'CLOSED' | 'REOPENED'

export type ScreeningSessionDate = string & { readonly __brand: 'ScreeningSessionDate' }

export interface ScreeningSessionRecord {
  readonly id: EntityId
  readonly locationId: EntityId
  readonly protocolVersionId: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly status: ScreeningSessionStatus
  readonly notes: string | null
  readonly openedBy: EntityId
  readonly openedAt: UtcTimestamp
  readonly closedBy: EntityId | null
  readonly closedAt: UtcTimestamp | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly rowVersion: number
}

export interface ScreeningSessionLifecycleRecord {
  readonly id: EntityId
  readonly screeningSessionId: EntityId
  readonly transitionType: ScreeningSessionLifecycleTransition
  readonly fromStatus: ScreeningSessionStatus | null
  readonly toStatus: ScreeningSessionStatus
  readonly reason: string | null
  readonly changedBy: EntityId
  readonly changedAt: UtcTimestamp
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number
}

export interface InsertScreeningSessionInput {
  readonly id: EntityId
  readonly lifecycleHistoryId: EntityId
  readonly locationId: EntityId
  readonly protocolVersionId: EntityId
  readonly sessionDate: ScreeningSessionDate
  readonly notes: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
}

export interface CloseScreeningSessionInput {
  readonly id: EntityId
  readonly lifecycleHistoryId: EntityId
  readonly expectedRowVersion: number
  readonly closedBy: EntityId
  readonly closedAt: UtcTimestamp
  readonly reason: string | null
}

export interface ReopenScreeningSessionInput {
  readonly id: EntityId
  readonly lifecycleHistoryId: EntityId
  readonly expectedRowVersion: number
  readonly reopenedBy: EntityId
  readonly reopenedAt: UtcTimestamp
  readonly reason: string
}

export interface ScreeningSessionListInput {
  readonly locationId: EntityId | null
  readonly status: ScreeningSessionStatus | null
  readonly dateFrom: ScreeningSessionDate | null
  readonly dateTo: ScreeningSessionDate | null
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export interface ScreeningSessionListResult {
  readonly items: readonly ScreeningSessionRecord[]
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly total: number
}

export type CloseScreeningSessionWriteResult =
  | { readonly status: 'CLOSED'; readonly session: ScreeningSessionRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'SESSION_VERSION_CONFLICT'; readonly session: ScreeningSessionRecord }
  | { readonly status: 'ALREADY_CLOSED'; readonly session: ScreeningSessionRecord }

export type ReopenScreeningSessionWriteResult =
  | { readonly status: 'REOPENED'; readonly session: ScreeningSessionRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'SESSION_VERSION_CONFLICT'; readonly session: ScreeningSessionRecord }
  | { readonly status: 'ALREADY_OPEN'; readonly session: ScreeningSessionRecord }

export interface ScreeningSessionRepository {
  getById(id: EntityId): ScreeningSessionRecord | null
  getByIdForWrite(
    connection: DatabaseTransactionConnection,
    id: EntityId
  ): ScreeningSessionRecord | null
  hasOpenForLocationForWrite(
    connection: DatabaseTransactionConnection,
    locationId: EntityId
  ): boolean
  list(input: ScreeningSessionListInput): ScreeningSessionListResult
  insert(
    connection: DatabaseTransactionConnection,
    input: InsertScreeningSessionInput
  ): ScreeningSessionRecord
  close(
    connection: DatabaseTransactionConnection,
    input: CloseScreeningSessionInput
  ): CloseScreeningSessionWriteResult
  reopen(
    connection: DatabaseTransactionConnection,
    input: ReopenScreeningSessionInput
  ): ReopenScreeningSessionWriteResult
}
