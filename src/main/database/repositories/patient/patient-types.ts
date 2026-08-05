import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import type {
  PatientAcknowledgmentStatus,
  PatientEditableFields,
  PatientSex,
  PatientStatus
} from '@shared/ipc'

export type PatientCode = string & { readonly __brand: 'PatientCode' }
export type PatientDisplayName = string & { readonly __brand: 'PatientDisplayName' }
export type PatientNormalizedName = string & { readonly __brand: 'PatientNormalizedName' }
export type PatientPhoneDigits = string & { readonly __brand: 'PatientPhoneDigits' }

export interface NormalizedPatientFields {
  readonly givenName: string | null
  readonly familyName: string | null
  readonly otherNames: string | null
  readonly displayName: PatientDisplayName
  readonly nameNormalized: PatientNormalizedName
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly ageAsOfDate: string | null
  readonly sex: PatientSex
  readonly village: string | null
  readonly quarter: string | null
  readonly phone: string | null
  readonly phoneNormalized: PatientPhoneDigits | null
  readonly alternateContactName: string | null
  readonly alternateContactPhone: string | null
  readonly residenceNotes: string | null
  readonly status: PatientStatus
  readonly acknowledgmentStatus: PatientAcknowledgmentStatus
}

export interface PatientSummaryRecord {
  readonly id: EntityId
  readonly patientCode: PatientCode
  readonly displayName: PatientDisplayName
  readonly givenName: string | null
  readonly familyName: string | null
  readonly otherNames: string | null
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly ageAsOfDate: string | null
  readonly sex: PatientSex
  readonly village: string | null
  readonly quarter: string | null
  readonly phone: string | null
  readonly status: PatientStatus
  readonly rowVersion: number
  readonly updatedAt: UtcTimestamp
}

export interface PatientDetailRecord extends PatientSummaryRecord {
  readonly alternateContactName: string | null
  readonly alternateContactPhone: string | null
  readonly residenceNotes: string | null
  readonly acknowledgmentStatus: PatientAcknowledgmentStatus
  readonly acknowledgmentRecordedAt: UtcTimestamp | null
  readonly acknowledgmentRecordedByDisplayName: string | null
  readonly createdAt: UtcTimestamp
  readonly createdByDisplayName: string
  readonly updatedByDisplayName: string
}

export interface PatientDuplicateCandidateRecord {
  readonly patient: PatientSummaryRecord
  readonly matchedOn: readonly string[]
  readonly score: number
}

export interface PatientDuplicatePairRecord {
  readonly pairKey: string
  readonly first: PatientSummaryRecord
  readonly second: PatientSummaryRecord
  readonly matchedOn: readonly string[]
  readonly score: number
}

export interface PatientSearchInput {
  readonly query: string
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export interface PatientSearchResultRecord {
  readonly items: readonly PatientSummaryRecord[]
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly total: number
}

export interface CreatePatientRepositoryInput {
  readonly id: EntityId
  readonly patientCode: PatientCode
  readonly fields: NormalizedPatientFields
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
}

export interface UpdatePatientRepositoryInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly fields: NormalizedPatientFields
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface UpdatePatientDemographicsRepositoryInput {
  readonly id: EntityId
  readonly expectedRowVersion: number
  readonly fields: NormalizedPatientFields
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

interface InsertPatientAuditOutboxInputBase {
  readonly id: EntityId
  readonly aggregateId: EntityId
  readonly createdAt: UtcTimestamp
  readonly payload: Readonly<Record<string, unknown>>
}

export type InsertPatientAuditOutboxInput =
  | (InsertPatientAuditOutboxInputBase & {
      readonly operation: 'PATIENT_CREATED' | 'PATIENT_UPDATED' | 'DUPLICATE_REVIEWED'
      readonly payloadSchemaVersion: 'patient.registry.v1'
    })
  | (InsertPatientAuditOutboxInputBase & {
      readonly operation: 'PATIENT_DEMOGRAPHICS_AMENDED'
      readonly payloadSchemaVersion: 'patient.demographic-amendment.v1'
    })

export interface MarkNotDuplicateInput {
  readonly id: EntityId
  readonly patientIdA: EntityId
  readonly patientIdB: EntityId
  readonly pairKey: string
  readonly patientARowVersion: number
  readonly patientBRowVersion: number
  readonly patientAIdentityKey: string
  readonly patientBIdentityKey: string
  readonly reasonCodes: readonly string[]
  readonly reviewedBy: EntityId
  readonly reviewedAt: UtcTimestamp
}

export type PatientUpdateResultRecord =
  | { readonly status: 'UPDATED'; readonly patient: PatientDetailRecord }
  | { readonly status: 'PATIENT_VERSION_CONFLICT'; readonly patient: PatientDetailRecord }
  | { readonly status: 'NOT_FOUND' }

export type PatientDemographicUpdateResultRecord =
  | { readonly status: 'UPDATED'; readonly patient: PatientDetailRecord }
  | { readonly status: 'PATIENT_VERSION_CONFLICT'; readonly patient: PatientDetailRecord }
  | { readonly status: 'NOT_FOUND' }

export interface PatientRepository {
  nextPatientCode(connection: DatabaseTransactionConnection, updatedAt: UtcTimestamp): PatientCode
  search(input: PatientSearchInput): PatientSearchResultRecord
  getById(id: EntityId): PatientDetailRecord | null
  getByIdForWrite(
    connection: DatabaseTransactionConnection,
    id: EntityId
  ): PatientDetailRecord | null
  insert(
    connection: DatabaseTransactionConnection,
    input: CreatePatientRepositoryInput
  ): PatientDetailRecord
  update(
    connection: DatabaseTransactionConnection,
    input: UpdatePatientRepositoryInput
  ): PatientUpdateResultRecord
  updateDemographics(
    connection: DatabaseTransactionConnection,
    input: UpdatePatientDemographicsRepositoryInput
  ): PatientDemographicUpdateResultRecord
  recordRecentAccess(
    connection: DatabaseTransactionConnection,
    userId: EntityId,
    patientId: EntityId,
    viewedAt: UtcTimestamp
  ): void
  listRecent(userId: EntityId, limit: number): readonly PatientSummaryRecord[]
  findDuplicateCandidates(
    fields: NormalizedPatientFields,
    options: { readonly excludePatientId: EntityId | null; readonly limit: number }
  ): readonly PatientDuplicateCandidateRecord[]
  listPossibleDuplicatePairs(limit: number): readonly PatientDuplicatePairRecord[]
  markNotDuplicate(connection: DatabaseTransactionConnection, input: MarkNotDuplicateInput): void
  insertOutbox(
    connection: DatabaseTransactionConnection,
    input: InsertPatientAuditOutboxInput
  ): void
}

export interface PatientNormalizationOptions {
  readonly today: string
}

export type PatientEditableInput = PatientEditableFields
