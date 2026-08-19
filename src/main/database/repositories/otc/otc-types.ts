import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type OtcResponse =
  'REPORTED' | 'NONE_REPORTED' | 'UNKNOWN' | 'DECLINED' | 'PREFER_NOT_TO_ANSWER'
export type OtcCurrentlyTakingResponse = 'YES' | 'NO' | 'UNKNOWN'
export type OtcSourceType = 'PATIENT_REPORTED'
export type OtcDate = string & { readonly __brand: 'OtcDate' }

export interface OtcDraftRowRecord {
  readonly id: EntityId
  readonly otcDraftId: EntityId
  readonly sequenceNumber: number
  readonly productNameSnapshot: string | null
  readonly productNameNormalized: string | null
  readonly reasonForUse: string | null
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTakingResponse: OtcCurrentlyTakingResponse | null
  readonly sourceType: OtcSourceType
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface OtcDraftRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: OtcDate
  readonly periodEnd: OtcDate
  readonly otcResponse: OtcResponse | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly rowVersion: number
  readonly rows: readonly OtcDraftRowRecord[]
}

export interface OtcRecentMedicationSuggestionRecord {
  readonly productNameSnapshot: string
  readonly productNameNormalized: string
  readonly lastRecordedAt: UtcTimestamp
}

export interface OtcDraftOwnershipInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly installationId: EntityId
  readonly periodStart: OtcDate
  readonly periodEnd: OtcDate
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export interface OtcDraftRowInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly productNameSnapshot: string | null
  readonly reasonForUse: string | null
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTakingResponse: OtcCurrentlyTakingResponse | null
  readonly sourceType: OtcSourceType
}

export interface OtcDraftUpdateInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly otcResponse: OtcResponse | null
  readonly rows: readonly OtcDraftRowInput[]
  readonly actorId: EntityId
  readonly occurredAt: UtcTimestamp
}

export type OtcDraftUpdateResult =
  | { readonly status: 'UPDATED'; readonly draft: OtcDraftRecord }
  | { readonly status: 'UNCHANGED'; readonly draft: OtcDraftRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'VERSION_CONFLICT'; readonly draft: OtcDraftRecord }

export interface OtcRepository {
  findDraftByEncounter(encounterId: EntityId): OtcDraftRecord | null
  findDraftByEncounterForWrite(
    connection: DatabaseTransactionConnection,
    encounterId: EntityId
  ): OtcDraftRecord | null
  insertDraft(
    connection: DatabaseTransactionConnection,
    input: OtcDraftOwnershipInput
  ): OtcDraftRecord
  updateDraft(
    connection: DatabaseTransactionConnection,
    input: OtcDraftUpdateInput
  ): OtcDraftUpdateResult
  listRecentPatientMedications(
    patientId: EntityId,
    currentEncounterId: EntityId
  ): readonly OtcRecentMedicationSuggestionRecord[]
  listRecentPatientMedicationsForWrite(
    connection: DatabaseTransactionConnection,
    patientId: EntityId,
    currentEncounterId: EntityId
  ): readonly OtcRecentMedicationSuggestionRecord[]
}
