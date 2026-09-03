import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type MaterializedSyncResourceType =
  'PATIENT' | 'SCREENING_SESSION' | 'SCREENING_ENCOUNTER' | 'VITALS' | 'LIFESTYLE'

export type MaterializedSyncJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly MaterializedSyncJsonValue[]
  | Readonly<{ [key: string]: MaterializedSyncJsonValue }>

export interface MaterializedSyncActor {
  readonly localActorId: EntityId
  readonly displayName: string
  readonly role: 'LOCAL_ADMIN' | 'NURSE' | 'TRAINED_SCREENER'
  readonly active: boolean
  readonly updatedAt: UtcTimestamp
}

export interface MaterializedSyncRecord {
  readonly recordId: EntityId
  readonly resourceType: MaterializedSyncResourceType
  readonly localResourceId: EntityId
  readonly sourceRevision: number
  readonly schemaVersion:
    'patient.v1' | 'screening-session.v1' | 'screening-encounter.v1' | 'vitals.v1' | 'lifestyle.v1'
  readonly operation: 'UPSERT'
  readonly capturedAt: UtcTimestamp
  readonly sourceActorLocalId: EntityId
  readonly payload: Readonly<{ [key: string]: MaterializedSyncJsonValue }>
}

export interface MaterializedSyncBatchSource {
  readonly installationId: EntityId
  readonly locationId: EntityId
  readonly installationTimezone: string
  readonly actors: readonly MaterializedSyncActor[]
  readonly records: readonly MaterializedSyncRecord[]
  readonly outboxIds: readonly EntityId[]
}

export interface SyncSnapshotRepository {
  materializeNext(
    connection: DatabaseTransactionConnection,
    now: UtcTimestamp
  ): MaterializedSyncBatchSource | null
}
