import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type PatientDemographicAmendmentReasonCode =
  | 'DATA_ENTRY_CORRECTION'
  | 'PATIENT_REPORTED_CHANGE'
  | 'CONTACT_INFORMATION_UPDATE'
  | 'RESIDENCE_INFORMATION_UPDATE'
  | 'STATUS_CHANGE'
  | 'OTHER'

export type PatientDemographicAmendmentFieldName =
  | 'given_name'
  | 'family_name'
  | 'other_names'
  | 'date_of_birth'
  | 'approximate_age_years'
  | 'age_as_of_date'
  | 'sex'
  | 'village'
  | 'quarter'
  | 'phone'
  | 'alternate_contact_name'
  | 'alternate_contact_phone'
  | 'residence_notes'
  | 'status'

export type PatientDemographicAmendmentValue = string | number | null

export interface PatientDemographicAmendmentChangeInput {
  readonly fieldName: PatientDemographicAmendmentFieldName
  readonly previousValue: PatientDemographicAmendmentValue
  readonly newValue: PatientDemographicAmendmentValue
}

export interface InsertPatientDemographicAmendmentInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
  readonly reasonCode: PatientDemographicAmendmentReasonCode
  readonly reasonNote: string | null
  readonly amendedBy: EntityId
  readonly amendedAt: UtcTimestamp
  readonly changes: readonly PatientDemographicAmendmentChangeInput[]
}

export interface PatientDemographicAmendmentChangeRecord {
  readonly fieldName: PatientDemographicAmendmentFieldName
  readonly previousValue: PatientDemographicAmendmentValue
  readonly newValue: PatientDemographicAmendmentValue
}

export interface PatientDemographicAmendmentRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
  readonly reasonCode: PatientDemographicAmendmentReasonCode
  readonly reasonNote: string | null
  readonly amendedBy: EntityId
  readonly amendedByDisplayName: string
  readonly amendedAt: UtcTimestamp
  readonly changes: readonly PatientDemographicAmendmentChangeRecord[]
}

export interface PatientDemographicAmendmentHistoryInput {
  readonly patientId: EntityId
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export interface PatientDemographicAmendmentHistoryResult {
  readonly items: readonly PatientDemographicAmendmentRecord[]
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly total: number
}

export interface PatientDemographicAmendmentRepository {
  insert(
    connection: DatabaseTransactionConnection,
    input: InsertPatientDemographicAmendmentInput
  ): void

  listByPatient(
    input: PatientDemographicAmendmentHistoryInput
  ): PatientDemographicAmendmentHistoryResult
}
