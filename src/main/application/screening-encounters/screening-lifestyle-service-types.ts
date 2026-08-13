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
  LifestylePhysicalActivityWeeklyInput,
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
  readonly otherActivities: readonly LifestyleOtherActivityRequest[]
}

export type CompleteLifestyleRequest = SaveLifestyleDraftRequest

export interface LifestyleWorkspaceSummary {
  readonly encounterId: EntityId
  readonly draft: LifestyleDraftRecord | null
  readonly activeAlcoholBaseline: LifestyleAlcoholBaselineRecord | null
  readonly activeTobaccoBaseline: LifestyleTobaccoBaselineRecord | null
  readonly activeWorkBaseline: LifestyleWorkBaselineRecord | null
  readonly referencedAlcoholBaseline: LifestyleAlcoholBaselineRecord | null
  readonly referencedTobaccoBaseline: LifestyleTobaccoBaselineRecord | null
  readonly referencedWorkBaseline: LifestyleWorkBaselineRecord | null
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

export interface ScreeningLifestyleService {
  getLifestyleWorkspace(request: GetLifestyleWorkspaceRequest): GetLifestyleWorkspaceResult
  saveAlcoholBaseline(request: SaveLifestyleAlcoholBaselineRequest): SaveLifestyleResult
  saveTobaccoBaseline(request: SaveLifestyleTobaccoBaselineRequest): SaveLifestyleResult
  saveWorkBaseline(request: SaveLifestyleWorkBaselineRequest): SaveLifestyleResult
  saveLifestyleDraft(request: SaveLifestyleDraftRequest): SaveLifestyleResult
  completeLifestyle(request: CompleteLifestyleRequest): CompleteLifestyleResult
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
