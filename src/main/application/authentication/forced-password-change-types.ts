import type {
  AuditEventRepository,
  DatabaseTransactionExecutor,
  InstallationRepository,
  LocalUserRecord,
  LocalUserRepository
} from '@main/database'
import type { EntityId, UtcClock, UtcTimestamp } from '@main/foundation'
import type {
  PasswordCredentialService,
  PlaintextPassword,
  StoredPasswordCredential
} from '@main/security'

export interface LocalForcedPasswordChangeInput {
  readonly userId: string
  readonly currentPassword: string
  readonly newPassword: string
  readonly confirmNewPassword: string
}

export type LocalForcedPasswordChangeRejectionReason =
  | 'CURRENT_PASSWORD_INVALID'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_CHANGE_NOT_REQUIRED'
  | 'NEW_PASSWORD_REUSES_CURRENT_PASSWORD'
  | 'NEW_PASSWORD_CONFIRMATION_MISMATCH'

export type LocalForcedPasswordChangeResult =
  | {
      readonly status: 'PASSWORD_CHANGED'
      readonly user: LocalUserRecord
    }
  | {
      readonly status: 'REJECTED'
      readonly reason: LocalForcedPasswordChangeRejectionReason
      readonly retryAt: UtcTimestamp | null
    }

export interface LocalForcedPasswordChangeService {
  changePassword(input: unknown): Promise<LocalForcedPasswordChangeResult>
}

export interface LocalForcedPasswordChangeServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly localUserRepository: LocalUserRepository
  readonly auditEventRepository: AuditEventRepository
  readonly passwordCredentialService: PasswordCredentialService
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly clock: UtcClock
}

export interface ParsedLocalForcedPasswordChangeInput {
  readonly userId: EntityId
  readonly currentPassword: PlaintextPassword
  readonly newPassword: PlaintextPassword
  readonly confirmNewPassword: PlaintextPassword
}

export interface ForcedPasswordChangeAuthenticationObservation {
  readonly user: LocalUserRecord
  readonly credential: StoredPasswordCredential
}
