import type {
  AuditEventRepository,
  FoodRepository,
  InstallationRepository,
  LifestyleRepository,
  LocationRepository,
  OtcRepository,
  ScreeningEncounterCompletionRepository,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRepository,
  ScreeningSessionRepository,
  ScreeningVitalsDraftRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { InstallationLocationService } from '../installation-location'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export type ScreeningCompletionSection = 'VITALS' | 'LIFESTYLE' | 'FOOD' | 'OTC'

export interface CompleteScreeningRequest {
  readonly encounterId: EntityId
  readonly expectedEncounterVersion: number
  readonly expectedVitalsVersion: number
  readonly expectedLifestyleVersion: number
  readonly expectedFoodVersion: number
  readonly expectedOtcVersion: number
  readonly reviewConfirmed: true
  readonly alcoholBaselineReviewConfirmedVersionId: EntityId | null
  readonly tobaccoBaselineReviewConfirmedVersionId: EntityId | null
}

export interface CompletedScreeningSummary {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly status: 'COMPLETED'
  readonly startedAt: UtcTimestamp
  readonly completedAt: UtcTimestamp
  readonly recordVersion: number
}

export type ScreeningCompletionControlledStatus =
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

export type CompleteScreeningResult =
  | { readonly status: 'COMPLETED'; readonly encounter: CompletedScreeningSummary }
  | { readonly status: 'ALREADY_COMPLETED'; readonly encounter: CompletedScreeningSummary }
  | { readonly status: 'INCOMPLETE'; readonly section: ScreeningCompletionSection }
  | { readonly status: ScreeningCompletionControlledStatus }

export interface ScreeningCompletionService {
  complete(request: CompleteScreeningRequest): CompleteScreeningResult
}

export interface ScreeningCompletionServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly screeningVitalsDraftRepository: ScreeningVitalsDraftRepository
  readonly lifestyleRepository: LifestyleRepository
  readonly foodRepository: FoodRepository
  readonly otcRepository: OtcRepository
  readonly completionRepository: ScreeningEncounterCompletionRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
