import type {
  AuditEventRepository,
  EncounterAddendumRecord,
  EncounterReviewFlagCategory,
  EncounterReviewFlagRecord,
  EncounterReviewFlagStatus,
  ManagedEncounterDetailRecord,
  PatientScreeningContextRecord,
  PatientScreeningHistoryRecord,
  InstallationRepository,
  ScreeningEncounterManagementRepository,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRepository,
  ScreeningEncounterStatus,
  SearchManagedEncountersResult
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcClock } from '@main/foundation/utc-clock'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export type EncounterManagementControlledStatus =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'LOCATION_NOT_CONFIGURED'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_INACTIVE'
  | 'ENCOUNTER_NOT_FOUND'
  | 'PATIENT_NOT_FOUND'
  | 'ENCOUNTER_NOT_MANAGEABLE'
  | 'ENCOUNTER_NOT_EMPTY'
  | 'VERSION_CONFLICT'
  | 'FLAG_NOT_FOUND'
  | 'UNAVAILABLE'

export interface SearchManagedEncountersRequest {
  readonly query: string
  readonly status: ScreeningEncounterStatus | 'ALL'
  readonly page: number
  readonly pageSize: 25 | 50 | 100
}
export type SearchManagedEncountersServiceResult =
  | { readonly status: 'LOADED'; readonly result: SearchManagedEncountersResult }
  | { readonly status: EncounterManagementControlledStatus }

export type GetManagedEncounterResult =
  | { readonly status: 'LOADED'; readonly detail: ManagedEncounterDetailRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type GetPatientScreeningContextResult =
  | { readonly status: 'LOADED'; readonly context: PatientScreeningContextRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type GetPatientScreeningHistoryResult =
  | { readonly status: 'LOADED'; readonly history: PatientScreeningHistoryRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type AddEncounterAddendumResult =
  | { readonly status: 'ADDED'; readonly addendum: EncounterAddendumRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type OpenEncounterReviewFlagResult =
  | { readonly status: 'OPENED'; readonly flag: EncounterReviewFlagRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type ResolveEncounterReviewFlagResult =
  | { readonly status: 'UPDATED'; readonly flag: EncounterReviewFlagRecord }
  | { readonly status: EncounterManagementControlledStatus }

export type VoidEmptyEncounterDraftResult =
  | { readonly status: 'VOIDED'; readonly recordVersion: number }
  | { readonly status: EncounterManagementControlledStatus }

export type EncounterCancellationReasonCode =
  'PATIENT_CHOSE_NOT_TO_CONTINUE' | 'CREATED_IN_ERROR' | 'UNABLE_TO_COMPLETE_TODAY' | 'OTHER'

export type CancelEncounterDraftResult =
  | { readonly status: 'VOIDED'; readonly recordVersion: number }
  | { readonly status: EncounterManagementControlledStatus }

export interface ScreeningEncounterManagementService {
  search(request: SearchManagedEncountersRequest): SearchManagedEncountersServiceResult
  getDetail(encounterId: EntityId): GetManagedEncounterResult
  getPatientContext(patientId: EntityId): GetPatientScreeningContextResult
  getPatientHistory(
    patientId: EntityId,
    page: number,
    pageSize: 25 | 50 | 100
  ): GetPatientScreeningHistoryResult
  addAddendum(encounterId: EntityId, noteText: string): AddEncounterAddendumResult
  openFlag(
    encounterId: EntityId,
    category: EncounterReviewFlagCategory,
    description: string
  ): OpenEncounterReviewFlagResult
  resolveFlag(
    encounterId: EntityId,
    flagId: EntityId,
    status: Extract<EncounterReviewFlagStatus, 'RESOLVED' | 'DISMISSED'>,
    resolutionNote: string
  ): ResolveEncounterReviewFlagResult
  voidEmptyDraft(
    encounterId: EntityId,
    expectedVersion: number,
    reason: string
  ): VoidEmptyEncounterDraftResult
  cancelDraft(
    encounterId: EntityId,
    expectedVersion: number,
    reasonCode: EncounterCancellationReasonCode,
    note: string | null
  ): CancelEncounterDraftResult
}

export interface ScreeningEncounterManagementServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationLocationService: InstallationLocationService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationRepository: InstallationRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly managementRepository: ScreeningEncounterManagementRepository
  readonly auditEventRepository: AuditEventRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly clock: UtcClock
}
