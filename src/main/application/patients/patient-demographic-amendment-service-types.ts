import type {
  AuditEventRepository,
  InstallationRepository,
  LocalUserRole,
  PatientDemographicAmendmentHistoryInput,
  PatientDemographicAmendmentHistoryResult,
  PatientDemographicAmendmentReasonCode,
  PatientDemographicAmendmentRepository,
  PatientDetailRecord,
  PatientRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { PatientSex, PatientStatus } from '@shared/ipc'

export interface PatientDemographicAmendmentServiceActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

export interface PatientDemographicPatch {
  readonly givenName?: string | null
  readonly familyName?: string | null
  readonly otherNames?: string | null
  readonly dateOfBirth?: string | null
  readonly approximateAgeYears?: number | null
  readonly ageAsOfDate?: string | null
  readonly sex?: PatientSex
  readonly village?: string | null
  readonly quarter?: string | null
  readonly phone?: string | null
  readonly alternateContactName?: string | null
  readonly alternateContactPhone?: string | null
  readonly residenceNotes?: string | null
  readonly status?: PatientStatus
}

export interface AmendPatientDemographicsRequest {
  readonly patientId: EntityId
  readonly expectedRowVersion: number
  readonly reasonCode: PatientDemographicAmendmentReasonCode
  readonly reasonNote: string | null
  readonly patch: PatientDemographicPatch
}

export type AmendPatientDemographicsResult =
  | {
      readonly status: 'AMENDED'
      readonly patient: PatientDetailRecord
      readonly amendmentId: EntityId
    }
  | {
      readonly status: 'PATIENT_VERSION_CONFLICT'
      readonly patient: PatientDetailRecord
    }
  | {
      readonly status: 'NOT_FOUND'
    }
  | {
      readonly status: 'FORBIDDEN'
    }

export type ListPatientDemographicAmendmentHistoryRequest = PatientDemographicAmendmentHistoryInput

export type ListPatientDemographicAmendmentHistoryResult = PatientDemographicAmendmentHistoryResult

export interface PatientDemographicAmendmentService {
  amend(
    request: AmendPatientDemographicsRequest,
    actor: PatientDemographicAmendmentServiceActor
  ): AmendPatientDemographicsResult

  listHistory(
    request: ListPatientDemographicAmendmentHistoryRequest,
    actor: PatientDemographicAmendmentServiceActor
  ): ListPatientDemographicAmendmentHistoryResult
}

export interface PatientDemographicAmendmentServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly patientRepository: PatientRepository
  readonly patientDemographicAmendmentRepository: PatientDemographicAmendmentRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
