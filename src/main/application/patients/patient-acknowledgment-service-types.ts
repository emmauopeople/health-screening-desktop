import type {
  AuditEventRepository,
  InstallationRepository,
  LocalUserRole,
  PatientAcknowledgmentDecisionStatus,
  PatientAcknowledgmentHistoryInput,
  PatientAcknowledgmentHistoryResult,
  PatientAcknowledgmentRecord,
  PatientAcknowledgmentRepository,
  PatientDetailRecord,
  PatientRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'

export interface PatientAcknowledgmentServiceActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

export interface RecordPatientAcknowledgmentRequest {
  readonly patientId: EntityId
  readonly expectedRowVersion: number
  readonly status: PatientAcknowledgmentDecisionStatus
  readonly note: string | null
}

export type RecordPatientAcknowledgmentResult =
  | {
      readonly status: 'RECORDED'
      readonly patient: PatientDetailRecord
      readonly acknowledgmentId: EntityId
    }
  | {
      readonly status: 'PATIENT_VERSION_CONFLICT'
      readonly patient: PatientDetailRecord
    }
  | {
      readonly status: 'NOT_FOUND'
    }
  | {
      readonly status: 'DUPLICATE_DECISION'
      readonly patient: PatientDetailRecord
      readonly acknowledgment: PatientAcknowledgmentRecord
    }

export type ListPatientAcknowledgmentHistoryRequest = PatientAcknowledgmentHistoryInput

export type ListPatientAcknowledgmentHistoryResult = PatientAcknowledgmentHistoryResult

export interface PatientAcknowledgmentService {
  record(
    request: RecordPatientAcknowledgmentRequest,
    actor: PatientAcknowledgmentServiceActor
  ): RecordPatientAcknowledgmentResult

  listHistory(
    request: ListPatientAcknowledgmentHistoryRequest,
    actor: PatientAcknowledgmentServiceActor
  ): ListPatientAcknowledgmentHistoryResult
}

export interface PatientAcknowledgmentServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly patientRepository: PatientRepository
  readonly patientAcknowledgmentRepository: PatientAcknowledgmentRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
