import type { LocalUserRecord, LocalUserRole } from '@main/database'
import type { UtcClock, UtcTimestamp } from '@main/foundation'

import type {
  LocalForcedPasswordChangeRejectionReason,
  LocalForcedPasswordChangeService
} from '../forced-password-change-types'
import type {
  LocalLoginAuthenticationService,
  LocalLoginRejectionReason
} from '../local-login-types'

export type LocalSessionLockReason = 'MANUAL' | 'IDLE_TIMEOUT'

export type LocalSessionState =
  | {
      readonly status: 'SIGNED_OUT'
      readonly revision: number
    }
  | {
      readonly status: 'PASSWORD_CHANGE_REQUIRED'
      readonly user: LocalUserRecord
      readonly establishedAt: UtcTimestamp
      readonly expiresAt: UtcTimestamp
      readonly revision: number
    }
  | {
      readonly status: 'ACTIVE'
      readonly user: LocalUserRecord
      readonly authenticatedAt: UtcTimestamp
      readonly lastActivityAt: UtcTimestamp
      readonly idleExpiresAt: UtcTimestamp
      readonly absoluteExpiresAt: UtcTimestamp
      readonly revision: number
    }
  | {
      readonly status: 'LOCKED'
      readonly user: LocalUserRecord
      readonly authenticatedAt: UtcTimestamp
      readonly lockedAt: UtcTimestamp
      readonly absoluteExpiresAt: UtcTimestamp
      readonly reason: LocalSessionLockReason
      readonly revision: number
    }

export type LocalSessionSnapshot = LocalSessionState
export type ActiveLocalSessionSnapshot = Extract<
  LocalSessionSnapshot,
  { readonly status: 'ACTIVE' }
>
export type PasswordChangeRequiredLocalSessionSnapshot = Extract<
  LocalSessionSnapshot,
  { readonly status: 'PASSWORD_CHANGE_REQUIRED' }
>

export type LocalSessionLoginResult =
  | {
      readonly status: 'ACTIVE'
      readonly session: ActiveLocalSessionSnapshot
    }
  | {
      readonly status: 'PASSWORD_CHANGE_REQUIRED'
      readonly session: PasswordChangeRequiredLocalSessionSnapshot
    }
  | {
      readonly status: 'REJECTED'
      readonly reason: LocalLoginRejectionReason
      readonly retryAt: UtcTimestamp | null
    }

export interface LocalSessionPasswordChangeInput {
  readonly currentPassword: string
  readonly newPassword: string
  readonly confirmNewPassword: string
}

export type LocalSessionPasswordChangeResult =
  | {
      readonly status: 'ACTIVE'
      readonly session: ActiveLocalSessionSnapshot
    }
  | {
      readonly status: 'REJECTED'
      readonly reason: LocalForcedPasswordChangeRejectionReason
      readonly retryAt: UtcTimestamp | null
    }

export interface LocalSessionUnlockInput {
  readonly password: string
}

export type LocalSessionUnlockResult =
  | {
      readonly status: 'ACTIVE'
      readonly session: ActiveLocalSessionSnapshot
    }
  | {
      readonly status: 'REJECTED'
      readonly reason: LocalLoginRejectionReason
      readonly retryAt: UtcTimestamp | null
    }

export interface ActiveLocalSessionContext {
  readonly user: LocalUserRecord
  readonly authenticatedAt: UtcTimestamp
  readonly lastActivityAt: UtcTimestamp
  readonly idleExpiresAt: UtcTimestamp
  readonly absoluteExpiresAt: UtcTimestamp
}

export interface LocalAuthenticationSessionService {
  login(input: unknown): Promise<LocalSessionLoginResult>
  changeRequiredPassword(input: unknown): Promise<LocalSessionPasswordChangeResult>
  unlock(input: unknown): Promise<LocalSessionUnlockResult>
  getSnapshot(): LocalSessionSnapshot
  recordActivity(): LocalSessionSnapshot
  lock(): LocalSessionSnapshot
  logout(): LocalSessionSnapshot
  requireActiveSession(): ActiveLocalSessionContext
  requireAnyRole(roles: unknown): ActiveLocalSessionContext
}

export interface LocalAuthenticationSessionServiceDependencies {
  readonly loginService: LocalLoginAuthenticationService
  readonly forcedPasswordChangeService: LocalForcedPasswordChangeService
  readonly clock: UtcClock
}

export interface ParsedLocalSessionPasswordChangeInput {
  readonly currentPassword: LocalSessionPasswordChangeInput['currentPassword']
  readonly newPassword: LocalSessionPasswordChangeInput['newPassword']
  readonly confirmNewPassword: LocalSessionPasswordChangeInput['confirmNewPassword']
}

export interface ParsedLocalSessionUnlockInput {
  readonly password: LocalSessionUnlockInput['password']
}

export type ParsedLocalSessionRoleList = readonly LocalUserRole[]
