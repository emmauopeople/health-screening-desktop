import type {
  AuditEventRepository,
  InstallationRepository,
  PatientRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type {
  PatientCreateRequest,
  PatientCreateResult,
  PatientFindDuplicatesRequest,
  PatientFindDuplicatesResult,
  PatientGetRequest,
  PatientGetResult,
  PatientListRecentRequest,
  PatientListRecentResult,
  PatientMarkNotDuplicateRequest,
  PatientMarkNotDuplicateResult,
  PatientSearchRequest,
  PatientSearchResult,
  PatientUpdateRequest,
  PatientUpdateResult
} from '@shared/ipc'

export interface PatientServiceActor {
  readonly userId: EntityId
}

export interface PatientRegistryService {
  search(request: PatientSearchRequest, actor: PatientServiceActor): PatientSearchResult
  get(request: PatientGetRequest, actor: PatientServiceActor): PatientGetResult
  create(request: PatientCreateRequest, actor: PatientServiceActor): PatientCreateResult
  update(request: PatientUpdateRequest, actor: PatientServiceActor): PatientUpdateResult
  listRecent(request: PatientListRecentRequest, actor: PatientServiceActor): PatientListRecentResult
  findDuplicates(
    request: PatientFindDuplicatesRequest,
    actor: PatientServiceActor
  ): PatientFindDuplicatesResult
  markNotDuplicate(
    request: PatientMarkNotDuplicateRequest,
    actor: PatientServiceActor
  ): PatientMarkNotDuplicateResult
}

export interface PatientRegistryServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly patientRepository: PatientRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
