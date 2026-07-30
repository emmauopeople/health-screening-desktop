import type {
  AuditEventRecord,
  AuditEventRepository,
  DatabaseTransactionExecutor,
  DeploymentName,
  IanaTimeZone,
  InstallationRecord,
  InstallationRepository,
  LocalUserRepository,
  LocalUserRecord,
  LocationAdministrativeArea,
  LocationDirections,
  LocationName,
  LocationRecord,
  LocationRepository,
  LocationType,
  UserDisplayName,
  Username
} from '@main/database'
import type { PasswordCredentialService } from '@main/security'

export type FirstRunInconsistencyCode =
  | 'INSTALLATION_MISSING_WITH_LOCAL_DATA'
  | 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR'
  | 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
  | 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION'

export type FirstRunBootstrapState =
  | { readonly status: 'REQUIRED' }
  | {
      readonly status: 'INITIALIZED'
      readonly installation: InstallationRecord
    }
  | {
      readonly status: 'INCONSISTENT'
      readonly code: FirstRunInconsistencyCode
    }

export interface FirstRunAdministratorInput {
  readonly username: unknown
  readonly displayName: unknown
  readonly temporaryPassword: unknown
}

export interface FirstRunLocationInput {
  readonly name: unknown
  readonly locationType: unknown
  readonly village: unknown
  readonly subdivision: unknown
  readonly region: unknown
  readonly directions: unknown
}

export interface FirstRunInitializationInput {
  readonly deploymentName: unknown
  readonly timeZone: unknown
  readonly administrator: FirstRunAdministratorInput
  readonly initialLocation: FirstRunLocationInput
}

export interface FirstRunInitializationResult {
  readonly status: 'INITIALIZED'
  readonly installation: InstallationRecord
  readonly administrator: LocalUserRecord
  readonly initialLocation: LocationRecord
  readonly auditEvents: readonly AuditEventRecord[]
}

export interface FirstRunBootstrapService {
  getState(): FirstRunBootstrapState
  initialize(input: unknown): Promise<FirstRunInitializationResult>
}

export interface FirstRunBootstrapServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly localUserRepository: LocalUserRepository
  readonly locationRepository: LocationRepository
  readonly auditEventRepository: AuditEventRepository
  readonly passwordCredentialService: PasswordCredentialService
  readonly transactionExecutor: DatabaseTransactionExecutor
}

export interface ParsedFirstRunAdministratorInput {
  readonly username: Username
  readonly displayName: UserDisplayName
  readonly temporaryPassword: unknown
}

export interface ParsedFirstRunLocationInput {
  readonly name: LocationName
  readonly locationType: LocationType
  readonly village: LocationAdministrativeArea | null
  readonly subdivision: LocationAdministrativeArea | null
  readonly region: LocationAdministrativeArea | null
  readonly directions: LocationDirections | null
}

export interface ParsedFirstRunInitializationInput {
  readonly deploymentName: DeploymentName
  readonly timeZone: IanaTimeZone
  readonly administrator: ParsedFirstRunAdministratorInput
  readonly initialLocation: ParsedFirstRunLocationInput
}
