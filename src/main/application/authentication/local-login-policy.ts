import type { LocalUserAuthenticationStateSnapshot, LocalUserRecord } from '@main/database'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation'

import { LocalLoginConcurrencyError, LocalLoginStateIntegrityError } from './local-login-errors'
import type { LocalLoginRejectionReason } from './local-login-types'

export const localLoginMaximumFailedAttempts = 5
export const localLoginLockDurationMinutes = 15

const lockDurationMilliseconds = localLoginLockDurationMinutes * 60 * 1000

export interface LocalLoginPolicyEvaluation {
  readonly activeLock: boolean
  readonly expiredLock: boolean
  readonly effectiveFailedLoginCount: number
}

export interface LocalLoginInvalidPasswordTransition {
  readonly nextState: LocalUserAuthenticationStateSnapshot
  readonly reason: Extract<LocalLoginRejectionReason, 'INVALID_CREDENTIALS' | 'ACCOUNT_LOCKED'>
  readonly retryAt: UtcTimestamp | null
  readonly lockApplied: boolean
}

export function getLocalUserAuthenticationStateSnapshot(
  user: LocalUserRecord
): LocalUserAuthenticationStateSnapshot {
  return Object.freeze({
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    updatedAt: user.updatedAt
  })
}

export function evaluateLocalLoginPolicyState(
  state: LocalUserAuthenticationStateSnapshot,
  currentTime: UtcTimestamp
): LocalLoginPolicyEvaluation {
  assertCanonicalUtcTimestamp(currentTime)
  assertValidLocalLoginPolicyState(state)

  const activeLock = state.lockedUntil !== null && state.lockedUntil > currentTime
  const expiredLock = state.lockedUntil !== null && state.lockedUntil <= currentTime

  return Object.freeze({
    activeLock,
    expiredLock,
    effectiveFailedLoginCount: expiredLock ? 0 : state.failedLoginCount
  })
}

export function createInvalidPasswordTransition(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalLoginInvalidPasswordTransition {
  const evaluation = evaluateLocalLoginPolicyState(state, transactionTime)

  if (evaluation.activeLock) {
    throw new LocalLoginConcurrencyError()
  }

  const nextCount = evaluation.effectiveFailedLoginCount + 1

  if (nextCount < localLoginMaximumFailedAttempts) {
    return Object.freeze({
      nextState: Object.freeze({
        failedLoginCount: nextCount,
        lockedUntil: null,
        lastLoginAt: state.lastLoginAt,
        updatedAt: transactionTime
      }),
      reason: 'INVALID_CREDENTIALS' as const,
      retryAt: null,
      lockApplied: false
    })
  }

  if (nextCount === localLoginMaximumFailedAttempts) {
    const lockedUntil = addLocalLoginLockDuration(transactionTime)

    return Object.freeze({
      nextState: Object.freeze({
        failedLoginCount: localLoginMaximumFailedAttempts,
        lockedUntil,
        lastLoginAt: state.lastLoginAt,
        updatedAt: transactionTime
      }),
      reason: 'ACCOUNT_LOCKED' as const,
      retryAt: lockedUntil,
      lockApplied: true
    })
  }

  throw new LocalLoginStateIntegrityError()
}

export function createSuccessfulLoginState(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalUserAuthenticationStateSnapshot {
  evaluateLocalLoginPolicyState(state, transactionTime)

  return Object.freeze({
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: transactionTime,
    updatedAt: transactionTime
  })
}

export function createActiveLockAttemptState(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalUserAuthenticationStateSnapshot {
  const evaluation = evaluateLocalLoginPolicyState(state, transactionTime)

  if (!evaluation.activeLock) {
    throw new LocalLoginConcurrencyError()
  }

  return Object.freeze({
    failedLoginCount: state.failedLoginCount,
    lockedUntil: state.lockedUntil,
    lastLoginAt: state.lastLoginAt,
    updatedAt: transactionTime
  })
}

export function addLocalLoginLockDuration(transactionTime: UtcTimestamp): UtcTimestamp {
  assertCanonicalUtcTimestamp(transactionTime)

  const lockedUntil = parseUtcTimestamp(
    new Date(Date.parse(transactionTime) + lockDurationMilliseconds).toISOString()
  )

  if (lockedUntil <= transactionTime) {
    throw new LocalLoginStateIntegrityError()
  }

  return lockedUntil
}

export function assertNonDecreasingLocalLoginTime(
  previous: UtcTimestamp,
  next: UtcTimestamp
): void {
  assertCanonicalUtcTimestamp(previous)
  assertCanonicalUtcTimestamp(next)

  if (next < previous) {
    throw new LocalLoginStateIntegrityError()
  }
}

function assertValidLocalLoginPolicyState(state: LocalUserAuthenticationStateSnapshot): void {
  try {
    assertCanonicalUtcTimestamp(state.updatedAt)

    if (state.lastLoginAt !== null) {
      assertCanonicalUtcTimestamp(state.lastLoginAt)
    }

    if (state.lockedUntil !== null) {
      assertCanonicalUtcTimestamp(state.lockedUntil)
    }

    if (
      !Number.isSafeInteger(state.failedLoginCount) ||
      state.failedLoginCount < 0 ||
      state.failedLoginCount > localLoginMaximumFailedAttempts
    ) {
      throw new LocalLoginStateIntegrityError()
    }

    if (state.failedLoginCount < localLoginMaximumFailedAttempts && state.lockedUntil !== null) {
      throw new LocalLoginStateIntegrityError()
    }

    if (state.failedLoginCount === localLoginMaximumFailedAttempts && state.lockedUntil === null) {
      throw new LocalLoginStateIntegrityError()
    }
  } catch (error) {
    if (error instanceof LocalLoginStateIntegrityError) {
      throw new LocalLoginStateIntegrityError(error.errorType)
    }

    throw new LocalLoginStateIntegrityError()
  }
}

function assertCanonicalUtcTimestamp(value: UtcTimestamp): void {
  try {
    parseUtcTimestamp(value)
  } catch {
    throw new LocalLoginStateIntegrityError()
  }
}
