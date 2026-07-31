import type { LocalUserAuthenticationStateSnapshot } from '@main/database'
import type { UtcTimestamp } from '@main/foundation'

import { LocalForcedPasswordChangeStateIntegrityError } from './forced-password-change-errors'
import {
  createActiveLockAttemptState,
  createInvalidPasswordTransition,
  evaluateLocalLoginPolicyState,
  type LocalLoginInvalidPasswordTransition
} from './local-login-policy'

export function createForcedPasswordChangeProofState(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalUserAuthenticationStateSnapshot {
  evaluateForcedPasswordChangeState(state, transactionTime)

  return Object.freeze({
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: state.lastLoginAt,
    updatedAt: transactionTime
  })
}

export function createForcedPasswordChangeInvalidCurrentPasswordTransition(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalLoginInvalidPasswordTransition {
  try {
    return createInvalidPasswordTransition(state, transactionTime)
  } catch (error) {
    throw toForcedPasswordChangeStateError(error)
  }
}

export function createForcedPasswordChangeActiveLockAttemptState(
  state: LocalUserAuthenticationStateSnapshot,
  transactionTime: UtcTimestamp
): LocalUserAuthenticationStateSnapshot {
  try {
    return createActiveLockAttemptState(state, transactionTime)
  } catch (error) {
    throw toForcedPasswordChangeStateError(error)
  }
}

export function evaluateForcedPasswordChangeState(
  state: LocalUserAuthenticationStateSnapshot,
  currentTime: UtcTimestamp
): ReturnType<typeof evaluateLocalLoginPolicyState> {
  try {
    return evaluateLocalLoginPolicyState(state, currentTime)
  } catch (error) {
    throw toForcedPasswordChangeStateError(error)
  }
}

function toForcedPasswordChangeStateError(
  error: unknown
): LocalForcedPasswordChangeStateIntegrityError {
  if (error instanceof LocalForcedPasswordChangeStateIntegrityError) {
    return new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
  }

  return new LocalForcedPasswordChangeStateIntegrityError()
}
