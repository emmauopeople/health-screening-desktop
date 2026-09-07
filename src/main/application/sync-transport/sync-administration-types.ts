import type {
  AuditEventRepository,
  DatabaseTransactionExecutor,
  InstallationRepository,
  SyncTransportBatchRepository
} from '@main/database'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { LocalAuthenticationSessionService } from '../authentication/session'
import type { SyncCredentialProtector } from './sync-transport-types'

export type SyncAdministrationActivityState =
  'NOT_CONFIGURED' | 'UP_TO_DATE' | 'PENDING' | 'SYNCHRONIZING' | 'RETRY_SCHEDULED'

export interface SyncAdministrationActivity {
  readonly state: SyncAdministrationActivityState
  readonly pendingChangeCount: number
  readonly pendingAcknowledgmentCount: number
  readonly lastSuccessfulSyncAt: UtcTimestamp | null
  readonly nextRetryAt: UtcTimestamp | null
}

export type SyncAdministrationConfiguration =
  | { readonly status: 'NOT_CONFIGURED' }
  | {
      readonly status: 'CONFIGURED'
      readonly apiBaseUrl: string
      readonly tokenPrefix: string
      readonly updatedAt: UtcTimestamp
    }

export type GetSyncAdministrationStateResult =
  | {
      readonly status: 'READY'
      readonly configuration: SyncAdministrationConfiguration
      readonly activity: SyncAdministrationActivity
    }
  | { readonly status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE' }

export type ConfigureSyncAdministrationResult =
  | {
      readonly status: 'CONFIGURED'
      readonly configuration: Extract<SyncAdministrationConfiguration, { status: 'CONFIGURED' }>
    }
  | {
      readonly status:
        | 'AUTHENTICATION_REQUIRED'
        | 'FORBIDDEN'
        | 'VALIDATION_FAILED'
        | 'PROTECTION_UNAVAILABLE'
        | 'UNAVAILABLE'
    }

export interface SyncAdministrationService {
  getState(): GetSyncAdministrationStateResult
  configure(request: unknown): ConfigureSyncAdministrationResult
}

export interface SyncAdministrationServiceDependencies {
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly repository: SyncTransportBatchRepository
  readonly installationRepository: InstallationRepository
  readonly auditEventRepository: AuditEventRepository
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly credentialProtector: SyncCredentialProtector
}
