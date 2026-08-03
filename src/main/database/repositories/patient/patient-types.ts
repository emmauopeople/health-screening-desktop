import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import type {
  PatientAcknowledgmentStatus,
  PatientDuplicateReasonCode,
  PatientSearchSuccessData,
  PatientSex,
  PatientStatus
} from '@shared/ipc'

export type PatientPageSize = PatientSearchSuccessData['pageSize']

export interface PatientRegistrationIdentityInput {
  readonly givenName: string
  readonly middleName: string | null
  readonly familyName: string
  readonly sex: PatientSex
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly approximateAgeAsOfDate: string | null
  readonly village: string
  readonly quarter: string | null
  readonly phone: string | null
}

export interface PatientSearchInput {
  readonly query: string
  readonly filters: {
    readonly dateOfBirth: string | null
    readonly approximateAgeYears: number | null
    readonly sex: PatientSex | null
    readonly village: string | null
    readonly quarter: string | null
  }
  readonly page: number
  readonly pageSize: PatientPageSize
}

export interface CreatePatientInput extends PatientRegistrationIdentityInput {
  readonly id: EntityId
  readonly identifierId: EntityId
  readonly acknowledgmentId: EntityId
  readonly outboxId: EntityId
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly acknowledgmentStatus: PatientAcknowledgmentStatus
  readonly acknowledgmentReference: string | null
}

export interface PatientRecord {
  readonly id: EntityId
  readonly patientCode: string
  readonly displayName: string
  readonly givenName: string
  readonly middleName: string | null
  readonly familyName: string
  readonly nameNormalized: string
  readonly sex: PatientSex | null
  readonly dateOfBirth: string | null
  readonly approximateAgeYears: number | null
  readonly approximateAgeAsOfDate: string | null
  readonly phone: string | null
  readonly phoneNormalized: string | null
  readonly village: string | null
  readonly quarter: string | null
  readonly status: PatientStatus
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface PatientSearchResult {
  readonly rows: readonly PatientRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: PatientPageSize
}

export interface PatientDuplicateCandidateRecord {
  readonly patient: PatientRecord
  readonly reasonCodes: readonly PatientDuplicateReasonCode[]
}

export interface PatientRepository {
  getById(id: EntityId): PatientRecord | null
  search(input: PatientSearchInput): PatientSearchResult
  findDuplicateCandidates(
    input: PatientRegistrationIdentityInput
  ): readonly PatientDuplicateCandidateRecord[]
  insert(scopedConnection: DatabaseTransactionConnection, input: CreatePatientInput): PatientRecord
}
