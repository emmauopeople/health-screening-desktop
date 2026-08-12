import type {
  AuditEventRepository,
  InstallationRepository,
  LocationRepository,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRepository,
  ScreeningSessionRepository,
  ScreeningVitalsDraftRecord,
  ScreeningVitalsDraftRepository,
  VitalsMeasurementSite,
  VitalsPatientPosition
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { InstallationLocationService } from '../installation-location'
import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { CurrentScreeningSessionService } from '../screening-sessions'

export interface GetVitalsDraftRequest {
  readonly encounterId: EntityId
}

export interface SaveVitalsDraftReadingInput {
  readonly id: EntityId | null
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: VitalsMeasurementSite | null
  readonly patientPosition: VitalsPatientPosition | null
  readonly measurementTime: string | null
}

export interface SaveVitalsDraftRequest {
  readonly encounterId: EntityId
  readonly expectedVersion: number | null
  readonly readings: readonly SaveVitalsDraftReadingInput[]
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
}

export interface VitalsDraftReadingSummary {
  readonly id: EntityId
  readonly sequenceNumber: number
  readonly systolic: number | null
  readonly diastolic: number | null
  readonly pulse: number | null
  readonly measurementSite: VitalsMeasurementSite | null
  readonly patientPosition: VitalsPatientPosition | null
  readonly measurementTime: string | null
}

export interface VitalsDraftSummary {
  readonly id: EntityId
  readonly encounterId: EntityId
  readonly status: ScreeningVitalsDraftRecord['status']
  readonly readings: readonly VitalsDraftReadingSummary[]
  readonly weightKg: number | null
  readonly waistCm: number | null
  readonly notes: string | null
  readonly rowVersion: number
  readonly updatedAt: UtcTimestamp
}

export type VitalsDraftControlledStatus =
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

export type GetVitalsDraftResult =
  | { readonly status: 'LOADED'; readonly draft: VitalsDraftSummary | null }
  | { readonly status: VitalsDraftControlledStatus }

export type SaveVitalsDraftResult =
  | { readonly status: 'SAVED'; readonly draft: VitalsDraftSummary }
  | { readonly status: VitalsDraftControlledStatus }

export type CompleteVitalsStepResult =
  | { readonly status: 'COMPLETED'; readonly draft: VitalsDraftSummary }
  | { readonly status: VitalsDraftControlledStatus }

export interface ScreeningVitalsDraftService {
  getVitalsDraft(request: GetVitalsDraftRequest): GetVitalsDraftResult
  saveVitalsDraft(request: SaveVitalsDraftRequest): SaveVitalsDraftResult
  completeVitalsStep(request: SaveVitalsDraftRequest): CompleteVitalsStepResult
}

export interface ScreeningVitalsDraftServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly currentScreeningSessionService: CurrentScreeningSessionService
  readonly installationLocationService: InstallationLocationService
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly screeningVitalsDraftRepository: ScreeningVitalsDraftRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
