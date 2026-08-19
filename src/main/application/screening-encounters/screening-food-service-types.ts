import type {
  AuditEventRepository,
  FoodCatalogItemRecord,
  FoodDraftRecord,
  FoodFrequencyCode,
  FoodRecentSuggestionRecord,
  FoodRepository,
  FoodResponse,
  InstallationRepository,
  LocationRepository,
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

export interface GetFoodWorkspaceRequest {
  readonly encounterId: EntityId
}

export interface SaveFoodDraftRowRequest {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly catalogCode: string | null
  readonly foodName: string
  readonly frequencyCode: FoodFrequencyCode | null
  readonly preparationNote: string | null
}

export interface SaveFoodDraftRequest {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly foodResponse: FoodResponse | null
  readonly rows: readonly SaveFoodDraftRowRequest[]
}

export interface FoodDraftRowSummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly catalogCode: string | null
  readonly foodNameSnapshot: string
  readonly foodNameNormalized: string
  readonly frequencyCode: FoodFrequencyCode | null
  readonly preparationNote: string | null
  readonly updatedAt: UtcTimestamp
}

export interface FoodDraftSummary {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly foodResponse: FoodResponse | null
  readonly rowVersion: number
  readonly periodStart: FoodDraftRecord['periodStart']
  readonly periodEnd: FoodDraftRecord['periodEnd']
  readonly rows: readonly FoodDraftRowSummary[]
  readonly updatedAt: UtcTimestamp
}

export interface FoodCatalogItemSummary {
  readonly code: string
  readonly displayName: string
  readonly normalizedSearchName: string
  readonly sortOrder: number
}

export interface FoodRecentSuggestionSummary {
  readonly catalogCode: string | null
  readonly foodNameSnapshot: string
  readonly foodNameNormalized: string
  readonly lastRecordedAt: UtcTimestamp
}

export interface FoodWorkspaceSummary {
  readonly encounterId: EntityId
  readonly draft: FoodDraftSummary | null
  readonly catalogItems: readonly FoodCatalogItemSummary[]
  readonly recentFoods: readonly FoodRecentSuggestionSummary[]
}

export type FoodServiceControlledStatus =
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

export type GetFoodWorkspaceResult =
  | { readonly status: 'LOADED'; readonly workspace: FoodWorkspaceSummary }
  | { readonly status: FoodServiceControlledStatus }

export type SaveFoodDraftResult =
  | { readonly status: 'SAVED'; readonly workspace: FoodWorkspaceSummary }
  | { readonly status: FoodServiceControlledStatus }

export interface ScreeningFoodService {
  getWorkspace(request: GetFoodWorkspaceRequest): GetFoodWorkspaceResult
  saveDraft(request: SaveFoodDraftRequest): SaveFoodDraftResult
}

export interface ScreeningFoodServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly foodRepository: FoodRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}

export function toFoodCatalogItemSummary(item: FoodCatalogItemRecord): FoodCatalogItemSummary {
  return Object.freeze({
    code: item.code,
    displayName: item.displayName,
    normalizedSearchName: item.normalizedSearchName,
    sortOrder: item.sortOrder
  })
}

export function toFoodRecentSuggestionSummary(
  item: FoodRecentSuggestionRecord
): FoodRecentSuggestionSummary {
  return Object.freeze({
    catalogCode: item.catalogCode,
    foodNameSnapshot: item.foodNameSnapshot,
    foodNameNormalized: item.foodNameNormalized,
    lastRecordedAt: item.lastRecordedAt
  })
}
