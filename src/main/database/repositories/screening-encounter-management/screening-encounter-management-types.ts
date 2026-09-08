import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import type { ScreeningEncounterStatus } from '../screening-encounter'

export type EncounterReviewFlagCategory =
  'POSSIBLE_DATA_ERROR' | 'MISSING_INFORMATION' | 'WRONG_PATIENT' | 'DUPLICATE_ENCOUNTER' | 'OTHER'
export type EncounterReviewFlagStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED'

export interface ManagedEncounterSummaryRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly patientCode: string
  readonly patientDisplayName: string
  readonly dateOfBirth: string | null
  readonly locationName: string
  readonly status: ScreeningEncounterStatus
  readonly startedAt: UtcTimestamp
  readonly completedAt: UtcTimestamp | null
  readonly noteCount: number
  readonly openFlagCount: number
  readonly recordVersion: number
  readonly hasRecordedData: boolean
}

export interface EncounterAddendumRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly noteText: string
  readonly createdBy: EntityId
  readonly createdByDisplayName: string
  readonly createdAt: UtcTimestamp
}

export interface EncounterReviewFlagRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly category: EncounterReviewFlagCategory
  readonly description: string
  readonly status: EncounterReviewFlagStatus
  readonly openedBy: EntityId
  readonly openedByDisplayName: string
  readonly openedAt: UtcTimestamp
  readonly resolvedBy: EntityId | null
  readonly resolvedByDisplayName: string | null
  readonly resolvedAt: UtcTimestamp | null
  readonly resolutionNote: string | null
}

export interface ManagedEncounterVitalsRecord {
  readonly sequenceNumber: number
  readonly systolic: number
  readonly diastolic: number
  readonly pulse: number | null
  readonly measuredAt: UtcTimestamp
}

export interface ManagedEncounterLifestyleRecord {
  readonly questionCode: string
  readonly responseCode: string
}

export interface ManagedEncounterFoodRecord {
  readonly foodName: string
  readonly frequencyCode: string
  readonly notes: string | null
}

export interface ManagedEncounterOtcRecord {
  readonly productName: string
  readonly reasonForUse: string
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTaking: boolean | null
}

export interface ManagedEncounterDetailRecord {
  readonly encounter: ManagedEncounterSummaryRecord
  readonly vitals: readonly ManagedEncounterVitalsRecord[]
  readonly lifestyle: readonly ManagedEncounterLifestyleRecord[]
  readonly foods: readonly ManagedEncounterFoodRecord[]
  readonly otcMedications: readonly ManagedEncounterOtcRecord[]
  readonly addenda: readonly EncounterAddendumRecord[]
  readonly flags: readonly EncounterReviewFlagRecord[]
}

export interface SearchManagedEncountersInput {
  readonly locationId: EntityId
  readonly resumableSessionId: EntityId | null
  readonly query: string
  readonly status: ScreeningEncounterStatus | 'ALL'
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export interface SearchManagedEncountersResult {
  readonly items: readonly ManagedEncounterSummaryRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export type PatientContextNextAction = 'ROUTINE' | 'REFER' | 'URGENT_REFERRAL'
export type PatientContextReferralStatus = 'OPEN' | 'CONTACTED' | 'SEEN' | 'UNABLE_TO_CONFIRM'

export interface PatientContextEncounterRecord {
  readonly id: EntityId
  readonly completedAt: UtcTimestamp
  readonly systolic: number
  readonly diastolic: number
  readonly pulse: number
  readonly nextAction: PatientContextNextAction
  readonly weightKg: number | null
}

export interface PatientContextThirtyDayAverageRecord {
  readonly systolic: number
  readonly diastolic: number
  readonly encounterCount: number
}

export interface PatientContextReferralRecord {
  readonly id: EntityId
  readonly status: PatientContextReferralStatus
  readonly urgency: string
  readonly dueDate: string | null
  readonly lastContactDate: string | null
}

export interface PatientScreeningContextRecord {
  readonly recentEncounters: readonly PatientContextEncounterRecord[]
  readonly thirtyDayAverage: PatientContextThirtyDayAverageRecord | null
  readonly activeReferral: PatientContextReferralRecord | null
}

export type PatientHistoryReferralStatus = PatientContextReferralStatus | 'CLOSED'
export type PatientHistoryTreatmentAction =
  'TREATMENT_INITIATED' | 'TREATMENT_MODIFIED' | 'NEW_MEDICATION'
export type PatientHistoryMedicationChangeType = 'TREATMENT_MODIFIED' | 'NEW_MEDICATION'

export interface PatientHistoryMedicationChangeRecord {
  readonly id: EntityId
  readonly changeType: PatientHistoryMedicationChangeType
  readonly medicationName: string
  readonly dosage: string | null
  readonly frequency: string | null
}

export interface PatientHistoryReferralFollowupRecord {
  readonly id: EntityId
  readonly contactDate: string
  readonly providerSeen: boolean | null
  readonly reportedOutcome: string | null
  readonly treatmentActions: readonly PatientHistoryTreatmentAction[]
  readonly medicationChanges: readonly PatientHistoryMedicationChangeRecord[]
}

export interface PatientHistoryReferralRecord {
  readonly id: EntityId
  readonly status: PatientHistoryReferralStatus
  readonly urgency: string
  readonly dueDate: string | null
  readonly closedAt: UtcTimestamp | null
  readonly latestFollowup: PatientHistoryReferralFollowupRecord | null
}

export interface PatientHistoryEncounterRecord extends PatientContextEncounterRecord {
  readonly referral: PatientHistoryReferralRecord | null
}

export interface PatientScreeningHistoryRecord {
  readonly patientId: EntityId
  readonly items: readonly PatientHistoryEncounterRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly trendEncounters: readonly PatientContextEncounterRecord[]
  readonly thirtyDayAverage: PatientContextThirtyDayAverageRecord | null
}

export interface InsertEncounterAddendumInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly noteText: string
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
}

export interface InsertEncounterReviewFlagInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly category: EncounterReviewFlagCategory
  readonly description: string
  readonly openedBy: EntityId
  readonly openedAt: UtcTimestamp
}

export interface ResolveEncounterReviewFlagInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: 'RESOLVED' | 'DISMISSED'
  readonly resolutionNote: string
  readonly resolvedBy: EntityId
  readonly resolvedAt: UtcTimestamp
}

export interface ScreeningEncounterManagementRepository {
  search(input: SearchManagedEncountersInput): SearchManagedEncountersResult
  getDetail(
    encounterId: EntityId,
    locationId: EntityId,
    resumableSessionId: EntityId | null
  ): ManagedEncounterDetailRecord | null
  getPatientContext(
    patientId: EntityId,
    thirtyDayCutoff: UtcTimestamp,
    recentEncounterLimit: number
  ): PatientScreeningContextRecord
  getPatientHistory(
    patientId: EntityId,
    thirtyDayCutoff: UtcTimestamp,
    page: number,
    pageSize: 25 | 50 | 100,
    trendLimit: number
  ): PatientScreeningHistoryRecord | null
  insertAddendum(
    connection: DatabaseTransactionConnection,
    input: InsertEncounterAddendumInput
  ): EncounterAddendumRecord
  insertFlag(
    connection: DatabaseTransactionConnection,
    input: InsertEncounterReviewFlagInput
  ): EncounterReviewFlagRecord
  resolveFlag(
    connection: DatabaseTransactionConnection,
    input: ResolveEncounterReviewFlagInput
  ): EncounterReviewFlagRecord | null
  voidEmptyDraft(
    connection: DatabaseTransactionConnection,
    input: {
      readonly encounterId: EntityId
      readonly expectedVersion: number
      readonly reason: string
      readonly updatedAt: UtcTimestamp
    }
  ): 'VOIDED' | 'NOT_FOUND' | 'NOT_DRAFT' | 'VERSION_CONFLICT' | 'NOT_EMPTY'
  voidDraft(
    connection: DatabaseTransactionConnection,
    input: {
      readonly encounterId: EntityId
      readonly expectedVersion: number
      readonly reason: string
      readonly updatedAt: UtcTimestamp
    }
  ): 'VOIDED' | 'NOT_FOUND' | 'NOT_DRAFT' | 'VERSION_CONFLICT'
}
