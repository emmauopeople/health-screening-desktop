import type {
  AuditEventRepository,
  DatabaseTransactionExecutor,
  InstallationRepository,
  LocalUserRecord,
  LocalUserRepository,
  Username
} from '@main/database'
import type { UtcClock, UtcTimestamp } from '@main/foundation'
import type {
  PasswordCredentialService,
  PlaintextPassword,
  StoredPasswordCredential
} from '@main/security'

export interface LocalLoginInput {
  readonly username: string
  readonly password: string
}

export type LocalLoginRejectionReason =
  'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE' | 'ACCOUNT_LOCKED'

export type LocalLoginResult =
  | {
      readonly status: 'AUTHENTICATED'
      readonly user: LocalUserRecord
    }
  | {
      readonly status: 'REJECTED'
      readonly reason: LocalLoginRejectionReason
      readonly retryAt: UtcTimestamp | null
    }

export interface LocalLoginAuthenticationService {
  authenticate(input: unknown): Promise<LocalLoginResult>
}

export interface LocalLoginAuthenticationServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly localUserRepository: LocalUserRepository
  readonly auditEventRepository: AuditEventRepository
  readonly passwordCredentialService: PasswordCredentialService
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly clock: UtcClock
  readonly dummyCredential: StoredPasswordCredential
}

export interface ParsedLocalLoginInput {
  readonly username: Username
  readonly password: PlaintextPassword
}
