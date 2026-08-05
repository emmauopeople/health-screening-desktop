import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type PatientAcknowledgmentHistoryStatus = 'NOT_REQUESTED' | 'ACKNOWLEDGED' | 'DECLINED'

export type PatientAcknowledgmentDecisionStatus = 'ACKNOWLEDGED' | 'DECLINED'

export type PatientAcknowledgmentSourceType = 'LOCAL'

export interface InsertPatientAcknowledgmentInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly status: PatientAcknowledgmentDecisionStatus
  readonly note: string | null
  readonly recordedBy: EntityId
  readonly recordedAt: UtcTimestamp
  readonly priorRowVersion: number
  readonly resultingRowVersion: number
}

export interface PatientAcknowledgmentRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly status: PatientAcknowledgmentHistoryStatus
  readonly sourceType: PatientAcknowledgmentSourceType
  readonly note: string | null
  readonly recordedBy: EntityId
  readonly recordedByDisplayName: string
  readonly recordedAt: UtcTimestamp
  readonly priorRowVersion: number | null
  readonly resultingRowVersion: number | null
}

export interface PatientAcknowledgmentHistoryInput {
  readonly patientId: EntityId
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}

export interface PatientAcknowledgmentHistoryResult {
  readonly items: readonly PatientAcknowledgmentRecord[]
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly total: number
}

export interface PatientAcknowledgmentRepository {
  insert(connection: DatabaseTransactionConnection, input: InsertPatientAcknowledgmentInput): void

  getLatestByPatient(patientId: EntityId): PatientAcknowledgmentRecord | null

  listByPatient(input: PatientAcknowledgmentHistoryInput): PatientAcknowledgmentHistoryResult
}
