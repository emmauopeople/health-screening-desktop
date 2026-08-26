import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export interface ScreeningCompletionVitalsReadingInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly systolic: number
  readonly diastolic: number
  readonly pulse: number
  readonly arm: string
  readonly bodyPosition: string
  readonly measuredAt: UtcTimestamp
}

export interface ScreeningCompletionLifestyleLogInput {
  readonly id: EntityId
  readonly questionCode: string
  readonly responseCode: string
}

export interface ScreeningCompletionFoodLogInput {
  readonly id: EntityId
  readonly foodCode: string | null
  readonly foodName: string
  readonly foodNameNormalized: string
  readonly frequencyCode: string | null
  readonly notes: string | null
}

export interface ScreeningCompletionOtcLogInput {
  readonly id: EntityId
  readonly productName: string
  readonly productNameNormalized: string
  readonly reasonForUse: string
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTaking: boolean | null
}

export interface CompleteScreeningEncounterPersistenceInput {
  readonly encounterId: EntityId
  readonly expectedRecordVersion: number
  readonly actorId: EntityId
  readonly completedAt: UtcTimestamp
  readonly summarySystolic: number
  readonly summaryDiastolic: number
  readonly summaryPulse: number
  readonly nextActionCategory: 'ROUTINE' | 'REFER' | 'URGENT_REFERRAL'
  readonly decisionJson: string
  readonly vitalsReadings: readonly ScreeningCompletionVitalsReadingInput[]
  readonly lifestyleLogs: readonly ScreeningCompletionLifestyleLogInput[]
  readonly foodLogs: readonly ScreeningCompletionFoodLogInput[]
  readonly otcLogs: readonly ScreeningCompletionOtcLogInput[]
}

export type CompleteScreeningEncounterPersistenceResult =
  | { readonly status: 'COMPLETED'; readonly recordVersion: number }
  | { readonly status: 'VERSION_CONFLICT' }

export interface ScreeningEncounterCompletionRepository {
  complete(
    connection: DatabaseTransactionConnection,
    input: CompleteScreeningEncounterPersistenceInput
  ): CompleteScreeningEncounterPersistenceResult
}
