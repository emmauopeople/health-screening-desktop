import type {
  AuditEventRepository,
  DatabaseTransactionExecutor,
  InstallationRepository,
  LocalUserRecord,
  PatientRepository
} from '@main/database'
import type {
  PatientCreateRequest,
  PatientCreateSuccessData,
  PatientDuplicateReviewData,
  PatientFindDuplicatesRequest,
  PatientGetSummaryRequest,
  PatientSearchRequest,
  PatientSearchSuccessData,
  PublicPatientSummary
} from '@shared/ipc'

export interface PatientRegistryActor {
  readonly user: LocalUserRecord
}

export interface PatientRegistryService {
  search(actor: PatientRegistryActor, request: PatientSearchRequest): PatientSearchSuccessData
  getSummary(actor: PatientRegistryActor, request: PatientGetSummaryRequest): PublicPatientSummary
  findDuplicates(
    actor: PatientRegistryActor,
    request: PatientFindDuplicatesRequest
  ): PatientDuplicateReviewData
  create(actor: PatientRegistryActor, request: PatientCreateRequest): PatientCreateSuccessData
}

export interface PatientRegistryServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly patientRepository: PatientRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
