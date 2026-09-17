import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type MaterializedSyncResourceType =
  | 'PATIENT'
  | 'SCREENING_SESSION'
  | 'SCREENING_ENCOUNTER'
  | 'VITALS'
  | 'LIFESTYLE'
  | 'FOOD'
  | 'OTC'
  | 'REFERRAL'
  | 'REFERRAL_STATUS'
  | 'REFERRAL_FOLLOWUP'
  | 'ENCOUNTER_ADDENDUM'
  | 'ENCOUNTER_REVIEW_FLAG'
  | 'ENCOUNTER_REVIEW_STATUS'

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
    | 'patient.v1'
    | 'screening-session.v1'
    | 'screening-encounter.v1'
    | 'vitals.v1'
    | 'lifestyle.v1'
    | 'food.v1'
    | 'otc.v1'
    | 'referral.v1'
    | 'referral-status.v1'
    | 'referral-followup.v1'
    | 'encounter-addendum.v1'
    | 'encounter-review-flag.v1'
    | 'encounter-review-status.v1'
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
