import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningVitalsDraftStatus = 'DRAFT' | 'VITALS_COMPLETE'
export type VitalsMeasurementSite = 'RIGHT_ARM' | 'LEFT_ARM' | 'LEFT_LEG' | 'RIGHT_LEG'
export type VitalsPatientPosition = 'LYING' | 'STANDING' | 'SITTING'
export type VitalsMeasurementTime = string & { readonly __brand: 'VitalsMeasurementTime' }

export interface ScreeningVitalsDraftReadingRecord {
  readonly id: EntityId
  readonly vitalsDraftId: EntityId
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: VitalsMeasurementSite | null
  readonly patientPosition: VitalsPatientPosition | null
  readonly measurementTime: VitalsMeasurementTime | null
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface ScreeningVitalsDraftRecord {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: ScreeningVitalsDraftStatus
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly rowVersion: number
  readonly readings: readonly ScreeningVitalsDraftReadingRecord[]
}

export interface ReplaceScreeningVitalsDraftReadingInput {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: VitalsMeasurementSite | null
  readonly patientPosition: VitalsPatientPosition | null
  readonly measurementTime: VitalsMeasurementTime | null
}

export interface InsertScreeningVitalsDraftInput {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: ScreeningVitalsDraftStatus
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly readings: readonly ReplaceScreeningVitalsDraftReadingInput[]
}

export interface UpdateScreeningVitalsDraftInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly status: ScreeningVitalsDraftStatus
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly readings: readonly ReplaceScreeningVitalsDraftReadingInput[]
}

export type UpdateScreeningVitalsDraftResult =
  | { readonly status: 'UPDATED'; readonly draft: ScreeningVitalsDraftRecord }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'VERSION_CONFLICT'; readonly draft: ScreeningVitalsDraftRecord }

export interface ScreeningVitalsDraftRepository {
  getByEncounterId(encounterId: EntityId): ScreeningVitalsDraftRecord | null
  getByEncounterIdForWrite(
    connection: DatabaseTransactionConnection,
    encounterId: EntityId
  ): ScreeningVitalsDraftRecord | null
  insert(
    connection: DatabaseTransactionConnection,
    input: InsertScreeningVitalsDraftInput
  ): ScreeningVitalsDraftRecord
  update(
    connection: DatabaseTransactionConnection,
    input: UpdateScreeningVitalsDraftInput
  ): UpdateScreeningVitalsDraftResult
}
