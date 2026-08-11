import type {
  AuditEventRepository,
  DatabaseTransactionExecutor,
  InstallationLocationConfigurationRepository,
  InstallationRepository,
  LocationName,
  LocationRepository,
  ScreeningEncounterRepository,
  ScreeningSessionRepository
} from '@main/database'
import type { EntityId } from '@main/foundation/entity-id'

import type { LocalAuthenticationSessionService } from '../authentication/session'

export interface ConfiguredInstallationLocation {
  readonly id: EntityId
  readonly displayName: LocationName
}

export type ResolveConfiguredInstallationLocationResult =
  | {
      readonly status: 'RESOLVED'
      readonly location: ConfiguredInstallationLocation
    }
  | {
      readonly status:
        'LOCATION_NOT_CONFIGURED' | 'LOCATION_NOT_FOUND' | 'LOCATION_INACTIVE' | 'UNAVAILABLE'
    }

export type AssignInitialInstallationLocationResult =
  | {
      readonly status: 'ASSIGNED'
      readonly location: ConfiguredInstallationLocation
    }
  | {
      readonly status: 'UNCHANGED'
      readonly location: ConfiguredInstallationLocation
    }
  | {
      readonly status:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'VALIDATION_FAILED'
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
        | 'LOCATION_ALREADY_CONFIGURED'
        | 'ACTIVE_SCREENING_WORK'
        | 'CONFIGURATION_CONFLICT'
        | 'UNAVAILABLE'
    }

export type ReconfigureInstallationLocationResult =
  | {
      readonly status: 'UPDATED'
      readonly location: ConfiguredInstallationLocation
    }
  | {
      readonly status: 'UNCHANGED'
      readonly location: ConfiguredInstallationLocation
    }
  | {
      readonly status:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'VALIDATION_FAILED'
        | 'LOCATION_NOT_CONFIGURED'
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
        | 'ACTIVE_SCREENING_WORK'
        | 'CONFIGURATION_CONFLICT'
        | 'UNAVAILABLE'
    }

export interface InstallationLocationService {
  resolveConfiguredInstallationLocation(): ResolveConfiguredInstallationLocationResult
  assignInitialInstallationLocation(request: unknown): AssignInitialInstallationLocationResult
  reconfigureInstallationLocation(request: unknown): ReconfigureInstallationLocationResult
}

export interface InstallationLocationServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationRepository: InstallationRepository
  readonly installationLocationConfigurationRepository: InstallationLocationConfigurationRepository
  readonly locationRepository: LocationRepository
  readonly screeningSessionRepository: ScreeningSessionRepository
  readonly screeningEncounterRepository: ScreeningEncounterRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
}
