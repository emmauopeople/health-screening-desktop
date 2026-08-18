import type {
  AuditEventRepository,
  InstallationRepository,
  LifestyleActivityInput,
  LifestyleAlcoholBaselineInput,
  LifestyleAlcoholBaselineRecord,
  LifestyleAlcoholWeeklyInput,
  LifestyleDraftRecord,
  LifestyleRepository,
  LifestyleTobaccoBaselineInput,
  LifestyleTobaccoBaselineRecord,
  LifestyleTobaccoProductInput,
  LifestyleTobaccoWeeklyInput,
  LifestyleWorkBaselineInput,
  LifestyleWorkBaselineRecord,
  LifestyleWorkWeeklyInput,
  LifestyleOtherActivityInput,
  LifestyleOtherActivityWeeklyResponse,
  LifestylePhysicalActivityWeeklyInput,
  LifestyleSedentaryTimeResponse,
  LocationRepository,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRepository,
  ScreeningSessionRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { InstallationLocationService } from '../installation-location'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export type LifestyleAlcoholBaselineRequest = Omit<
  LifestyleAlcoholBaselineInput,
  'id' | 'patientId' | 'installationId' | 'expectedCurrentVersion' | 'actorId' | 'occurredAt'
>
export type LifestyleTobaccoBaselineRequest = Omit<
  LifestyleTobaccoBaselineInput,
  'id' | 'patientId' | 'installationId' | 'expectedCurrentVersion' | 'actorId' | 'occurredAt'
>
export type LifestyleWorkBaselineRequest = Omit<
  LifestyleWorkBaselineInput,
  'id' | 'patientId' | 'installationId' | 'expectedCurrentVersion' | 'actorId' | 'occurredAt'
>

export type LifestyleAlcoholWeeklyRequest = Omit<LifestyleAlcoholWeeklyInput, 'id'> & {
  readonly id: EntityId | null
}
export type LifestyleTobaccoProductRequest = Omit<LifestyleTobaccoProductInput, 'id'> & {
  readonly id: EntityId | null
}
export type LifestyleTobaccoWeeklyRequest = Omit<LifestyleTobaccoWeeklyInput, 'id' | 'products'> & {
  readonly id: EntityId | null
  readonly products: readonly LifestyleTobaccoProductRequest[]
}
export type LifestyleActivityRequest = Omit<LifestyleActivityInput, 'id'> & {
  readonly id: EntityId | null
}
export type LifestylePhysicalActivityWeeklyRequest = Omit<
  LifestylePhysicalActivityWeeklyInput,
  'id' | 'activities'
> & {
  readonly id: EntityId | null
  readonly activities: readonly LifestyleActivityRequest[]
}
export type LifestyleWorkWeeklyRequest = Omit<LifestyleWorkWeeklyInput, 'id'> & {
  readonly id: EntityId | null
}
export type LifestyleOtherActivityRequest = Omit<LifestyleOtherActivityInput, 'id'> & {
  readonly id: EntityId | null
}

export interface LifestyleAlcoholWeeklySummary {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleAlcoholWeeklyInput['weeklyResponse']
  readonly drinkingDays: number | null
  readonly totalStandardizedDrinks: number | null
  readonly largestOneDayAmount: number | null
  readonly daysAtLargestAmount: number | null
  readonly commonBeverageTypes: LifestyleAlcoholWeeklyInput['commonBeverageTypes']
  readonly otherBeverageDescription: string | null
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoProductSummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly productType: LifestyleTobaccoProductInput['productType']
  readonly daysUsed: number
  readonly averageQuantityPerUseDay: number
  readonly unit: LifestyleTobaccoProductInput['unit']
  readonly secondhandSmokeExposure: boolean | null
  readonly otherProductDescription: string | null
  readonly otherUnitDescription: string | null
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoWeeklySummary {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleTobaccoWeeklyInput['weeklyResponse']
  readonly products: readonly LifestyleTobaccoProductSummary[]
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleActivitySummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly activityDomain: LifestyleActivityInput['activityDomain']
  readonly description: string | null
  readonly intensity: LifestyleActivityInput['intensity']
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerActiveDay: number
  readonly weeklyMinutes: number
  readonly updatedAt: UtcTimestamp
}

export interface LifestylePhysicalActivityWeeklySummary {
  readonly id: EntityId
  readonly weeklyResponse: LifestylePhysicalActivityWeeklyInput['weeklyResponse']
  readonly sedentaryTimeResponse: LifestyleSedentaryTimeResponse | null
  readonly sedentaryMinutesPerDay: number | null
  readonly activities: readonly LifestyleActivitySummary[]
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleWorkWeeklySummary {
  readonly id: EntityId
  readonly weeklyResponse: LifestyleWorkWeeklyInput['weeklyResponse']
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleOtherActivitySummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly category: LifestyleOtherActivityInput['category']
  readonly description: string | null
  readonly daysInPastSevenDays: number
  readonly averageMinutesPerDay: number
  readonly intensity: LifestyleOtherActivityInput['intensity']
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleDraftSummary {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: LifestyleDraftRecord['status']
  readonly rowVersion: number
  readonly periodStart: LifestyleDraftRecord['periodStart']
  readonly periodEnd: LifestyleDraftRecord['periodEnd']
  readonly alcoholBaselineVersionId: EntityId | null
  readonly tobaccoBaselineVersionId: EntityId | null
  readonly workBaselineVersionId: EntityId | null
  readonly otherActivityResponse: LifestyleOtherActivityWeeklyResponse | null
  readonly alcohol: LifestyleAlcoholWeeklySummary | null
  readonly tobacco: LifestyleTobaccoWeeklySummary | null
  readonly physicalActivity: LifestylePhysicalActivityWeeklySummary | null
  readonly work: LifestyleWorkWeeklySummary | null
  readonly otherActivities: readonly LifestyleOtherActivitySummary[]
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleAlcoholBaselineSummary {
  readonly id: EntityId
  readonly version: number
  readonly status: LifestyleAlcoholBaselineRecord['status']
  readonly everConsumed: LifestyleAlcoholBaselineRecord['everConsumed']
  readonly consumedPast12Months: LifestyleAlcoholBaselineRecord['consumedPast12Months']
  readonly commonBeverageTypes: LifestyleAlcoholBaselineRecord['commonBeverageTypes']
  readonly otherBeverageDescription: string | null
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleTobaccoBaselineSummary {
  readonly id: EntityId
  readonly version: number
  readonly status: LifestyleTobaccoBaselineRecord['status']
  readonly everRegularlyUsed: LifestyleTobaccoBaselineRecord['everRegularlyUsed']
  readonly formerUseApproximateStopDate: string | null
  readonly currentUseFrequency: LifestyleTobaccoBaselineRecord['currentUseFrequency']
  readonly productTypes: LifestyleTobaccoBaselineRecord['productTypes']
  readonly otherProductDescription: string | null
  readonly updatedAt: UtcTimestamp
}

export interface LifestyleWorkBaselineSummary {
  readonly id: EntityId
  readonly version: number
  readonly status: LifestyleWorkBaselineRecord['status']
  readonly occupationJobTitle: string | null
  readonly usualPhysicalDemand: LifestyleWorkBaselineRecord['usualPhysicalDemand']
  readonly typicalWorkdaysPerWeek: number | null
  readonly typicalHoursPerWorkday: number | null
  readonly shiftPattern: LifestyleWorkBaselineRecord['shiftPattern']
  readonly description: string | null
  readonly updatedAt: UtcTimestamp
}

export interface GetLifestyleWorkspaceRequest {
  readonly encounterId: EntityId
}

export interface SaveLifestyleAlcoholBaselineRequest extends LifestyleAlcoholBaselineRequest {
  readonly encounterId: EntityId
  readonly expectedBaselineVersion: number | null
  readonly expectedDraftVersion: number | null
}

export interface SaveLifestyleTobaccoBaselineRequest extends LifestyleTobaccoBaselineRequest {
  readonly encounterId: EntityId
  readonly expectedBaselineVersion: number | null
  readonly expectedDraftVersion: number | null
}

export interface SaveLifestyleWorkBaselineRequest extends LifestyleWorkBaselineRequest {
  readonly encounterId: EntityId
  readonly expectedBaselineVersion: number | null
  readonly expectedDraftVersion: number | null
}

export interface SaveLifestyleDraftRequest {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly alcohol: LifestyleAlcoholWeeklyRequest | null
  readonly tobacco: LifestyleTobaccoWeeklyRequest | null
  readonly physicalActivity: LifestylePhysicalActivityWeeklyRequest | null
  readonly work: LifestyleWorkWeeklyRequest | null
  readonly otherActivityResponse: LifestyleOtherActivityWeeklyResponse | null
  readonly otherActivities: readonly LifestyleOtherActivityRequest[]
}

export interface CompleteLifestyleRequest extends SaveLifestyleDraftRequest {
  readonly alcoholBaselineReviewConfirmedVersionId: EntityId | null
  readonly tobaccoBaselineReviewConfirmedVersionId: EntityId | null
}

export interface ReopenLifestyleRequest {
  readonly encounterId: EntityId
  readonly expectedVersion: number
}

export interface LifestyleWorkspaceSummary {
  readonly encounterId: EntityId
  readonly draft: LifestyleDraftSummary | null
  readonly activeAlcoholBaseline: LifestyleAlcoholBaselineSummary | null
  readonly activeTobaccoBaseline: LifestyleTobaccoBaselineSummary | null
  readonly activeWorkBaseline: LifestyleWorkBaselineSummary | null
  readonly referencedAlcoholBaseline: LifestyleAlcoholBaselineSummary | null
  readonly referencedTobaccoBaseline: LifestyleTobaccoBaselineSummary | null
  readonly referencedWorkBaseline: LifestyleWorkBaselineSummary | null
}

export type LifestyleServiceControlledStatus =
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

export type GetLifestyleWorkspaceResult =
  | { readonly status: 'LOADED'; readonly workspace: LifestyleWorkspaceSummary }
  | { readonly status: LifestyleServiceControlledStatus }

export type SaveLifestyleResult =
  | { readonly status: 'SAVED'; readonly workspace: LifestyleWorkspaceSummary }
  | { readonly status: LifestyleServiceControlledStatus }

export type CompleteLifestyleResult =
  | { readonly status: 'COMPLETED'; readonly workspace: LifestyleWorkspaceSummary }
  | { readonly status: LifestyleServiceControlledStatus }

export type ReopenLifestyleResult =
  | { readonly status: 'REOPENED'; readonly workspace: LifestyleWorkspaceSummary }
  | { readonly status: LifestyleServiceControlledStatus }

export interface ScreeningLifestyleService {
  getLifestyleWorkspace(request: GetLifestyleWorkspaceRequest): GetLifestyleWorkspaceResult
  saveAlcoholBaseline(request: SaveLifestyleAlcoholBaselineRequest): SaveLifestyleResult
  saveTobaccoBaseline(request: SaveLifestyleTobaccoBaselineRequest): SaveLifestyleResult
  saveWorkBaseline(request: SaveLifestyleWorkBaselineRequest): SaveLifestyleResult
  saveLifestyleDraft(request: SaveLifestyleDraftRequest): SaveLifestyleResult
  completeLifestyle(request: CompleteLifestyleRequest): CompleteLifestyleResult
  reopenLifestyle(request: ReopenLifestyleRequest): ReopenLifestyleResult
}

export interface ScreeningLifestyleServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly lifestyleRepository: LifestyleRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}

export type LifestyleServiceTimestamp = UtcTimestamp
