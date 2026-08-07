import type {
  AuditEventRepository,
  InstallationRepository,
  LocationRepository,
  PatientRepository,
  ScreeningEncounterOutboxRepository,
  ScreeningEncounterRecord,
  ScreeningEncounterRepository,
  ScreeningSessionRepository
} from '@main/database'
import type { DatabaseTransactionExecutor } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { LocalAuthenticationSessionService } from '../authentication/session'

export interface StartScreeningEncounterRequest {
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
}

export interface ScreeningEncounterStartSummary {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly status: ScreeningEncounterRecord['status']
  readonly startedAt: UtcTimestamp
  readonly recordVersion: number
}

export type StartScreeningEncounterResult =
  | {
      readonly status: 'STARTED'
      readonly encounter: ScreeningEncounterStartSummary
    }
  | {
      readonly status: 'ALREADY_EXISTS'
      readonly encounter: ScreeningEncounterStartSummary
    }
  | {
      readonly status: 'PATIENT_NOT_FOUND'
    }
  | {
      readonly status: 'PATIENT_INELIGIBLE'
    }
  | {
      readonly status: 'SESSION_NOT_FOUND'
    }
  | {
      readonly status: 'SESSION_CLOSED'
    }
  | {
      readonly status: 'SESSION_NOT_CURRENT'
    }
  | {
      readonly status: 'LOCATION_NOT_FOUND'
    }
  | {
      readonly status: 'LOCATION_INACTIVE'
    }
  | {
      readonly status: 'FORBIDDEN'
    }
  | {
      readonly status: 'VALIDATION_FAILED'
    }
  | {
      readonly status: 'AUTHENTICATION_REQUIRED'
    }
  | {
      readonly status: 'UNAVAILABLE'
    }

export interface ScreeningEncounterStartService {
  start(request: StartScreeningEncounterRequest): StartScreeningEncounterResult
}

export interface ScreeningEncounterStartServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationRepository: InstallationRepository
  readonly patientRepository: PatientRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly screeningEncounterOutboxRepository: ScreeningEncounterOutboxRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
