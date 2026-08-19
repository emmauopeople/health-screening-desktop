import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type FoodResponse = 'REPORTED' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER'
export type FoodFrequencyCode = '1_DAY' | '2_TO_3_DAYS' | '4_TO_6_DAYS' | 'EVERY_DAY'
export type FoodSourceType = 'PATIENT_REPORTED'
export type FoodDate = string & { readonly __brand: 'FoodDate' }

export interface FoodCatalogItemRecord {
  readonly code: string
  readonly displayName: string
  readonly normalizedSearchName: string
  readonly isActive: boolean
  readonly sortOrder: number
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface FoodDraftRowRecord {
  readonly id: EntityId
  readonly foodDraftId: EntityId
  readonly sequenceNumber: number
  readonly catalogCode: string | null
  readonly foodNameSnapshot: string
  readonly foodNameNormalized: string
  readonly frequencyCode: FoodFrequencyCode | null
  readonly preparationNote: string | null
  readonly sourceType: FoodSourceType
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface FoodDraftRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: FoodDate
  readonly periodEnd: FoodDate
  readonly foodResponse: FoodResponse | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly rowVersion: number
  readonly rows: readonly FoodDraftRowRecord[]
}

export interface FoodRecentSuggestionRecord {
  readonly catalogCode: string | null
  readonly foodNameSnapshot: string
  readonly foodNameNormalized: string
  readonly lastRecordedAt: UtcTimestamp
}

export interface FoodDraftOwnershipInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: FoodDate
  readonly periodEnd: FoodDate
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface FoodDraftRowInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly catalogCode: string | null
  readonly foodNameSnapshot: string
  readonly frequencyCode: FoodFrequencyCode | null
  readonly preparationNote: string | null
  readonly sourceType: FoodSourceType
}

export interface FoodDraftUpdateInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly foodResponse: FoodResponse | null
  readonly rows: readonly FoodDraftRowInput[]
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export type FoodDraftUpdateResult =
  | { readonly status: 'UPDATED'; readonly draft: FoodDraftRecord }
  | { readonly status: 'UNCHANGED'; readonly draft: FoodDraftRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'VERSION_CONFLICT'; readonly draft: FoodDraftRecord }

export interface FoodRepository {
  findDraftByEncounter(encounterId: EntityId): FoodDraftRecord | null
  findDraftByEncounterForWrite(
    connection: DatabaseTransactionConnection,
    encounterId: EntityId
  ): FoodDraftRecord | null
  insertDraft(
    connection: DatabaseTransactionConnection,
    input: FoodDraftOwnershipInput
  ): FoodDraftRecord
  updateDraft(
    connection: DatabaseTransactionConnection,
    input: FoodDraftUpdateInput
  ): FoodDraftUpdateResult
  listActiveCatalogItems(): readonly FoodCatalogItemRecord[]
  listActiveCatalogItemsForWrite(
    connection: DatabaseTransactionConnection
  ): readonly FoodCatalogItemRecord[]
  listRecentPatientFoods(
    patientId: EntityId,
    currentEncounterId: EntityId
  ): readonly FoodRecentSuggestionRecord[]
  listRecentPatientFoodsForWrite(
    connection: DatabaseTransactionConnection,
    patientId: EntityId,
    currentEncounterId: EntityId
  ): readonly FoodRecentSuggestionRecord[]
}
