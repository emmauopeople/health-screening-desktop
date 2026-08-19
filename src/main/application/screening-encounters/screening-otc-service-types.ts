import type {
  AuditEventRepository,
  InstallationRepository,
  LocationRepository,
  OtcCurrentlyTakingResponse,
  OtcDraftRecord,
  OtcRecentMedicationSuggestionRecord,
  OtcRepository,
  OtcResponse,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRepository,
  ScreeningSessionRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface GetOtcWorkspaceRequest {
  readonly encounterId: EntityId
}

export interface SaveOtcDraftRowRequest {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly productName: string | null
  readonly reasonForUse: string | null
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTakingResponse: OtcCurrentlyTakingResponse | null
}

export interface SaveOtcDraftRequest {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly otcResponse: OtcResponse | null
  readonly rows: readonly SaveOtcDraftRowRequest[]
}

export interface OtcDraftRowSummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly productNameSnapshot: string | null
  readonly productNameNormalized: string | null
  readonly reasonForUse: string | null
  readonly doseText: string | null
  readonly frequencyText: string | null
  readonly durationText: string | null
  readonly sourceOfMedication: string | null
  readonly currentlyTakingResponse: OtcCurrentlyTakingResponse | null
  readonly updatedAt: UtcTimestamp
}

export interface OtcDraftSummary {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly otcResponse: OtcResponse | null
  readonly rowVersion: number
  readonly periodStart: OtcDraftRecord['periodStart']
  readonly periodEnd: OtcDraftRecord['periodEnd']
  readonly rows: readonly OtcDraftRowSummary[]
  readonly updatedAt: UtcTimestamp
}

export interface OtcRecentMedicationSuggestionSummary {
  readonly productNameSnapshot: string
}

export interface OtcWorkspaceSummary {
  readonly encounterId: EntityId
  readonly draft: OtcDraftSummary | null
  readonly recentMedications: readonly OtcRecentMedicationSuggestionSummary[]
}

export type OtcServiceControlledStatus =
  | 'AUTHENTICATION_REQUIRED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'LOCATION_NOT_CONFIGURED'
  | 'LOCATION_NOT_FOUND'
  | 'LOCATION_INACTIVE'
  | 'ENCOUNTER_NOT_FOUND'
  | 'ENCOUNTER_NOT_EDITABLE'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'SESSION_NOT_CURRENT'
  | 'VERSION_CONFLICT'
  | 'UNAVAILABLE'

export type GetOtcWorkspaceResult =
  | { readonly status: 'LOADED'; readonly workspace: OtcWorkspaceSummary }
  | { readonly status: OtcServiceControlledStatus }

export type SaveOtcDraftResult =
  | { readonly status: 'SAVED'; readonly workspace: OtcWorkspaceSummary }
  | { readonly status: OtcServiceControlledStatus }

export interface ScreeningOtcService {
  getWorkspace(request: GetOtcWorkspaceRequest): GetOtcWorkspaceResult
  saveDraft(request: SaveOtcDraftRequest): SaveOtcDraftResult
}

export interface ScreeningOtcServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly otcRepository: OtcRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}

export function toOtcRecentMedicationSuggestionSummary(
  item: OtcRecentMedicationSuggestionRecord
): OtcRecentMedicationSuggestionSummary {
  return Object.freeze({
    productNameSnapshot: item.productNameSnapshot
  })
}
