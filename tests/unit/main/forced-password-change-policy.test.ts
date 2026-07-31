import { describe, expect, it } from 'vitest'

import {
  createForcedPasswordChangeActiveLockAttemptState,
  createForcedPasswordChangeInvalidCurrentPasswordTransition,
  createForcedPasswordChangeProofState,
  evaluateLocalLoginPolicyState,
  localLoginLockDurationMinutes,
  LocalForcedPasswordChangeStateIntegrityError
} from '@main/application'
import type { LocalUserAuthenticationStateSnapshot } from '@main/database'
import { parseUtcTimestamp } from '@main/foundation'

const previousLoginAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const updatedAt = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const transactionTime = parseUtcTimestamp('2026-07-30T12:05:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:20:00.000Z')

describe('forced password change policy', () => {
  it('successful proof resets failed state, clears lock, preserves last login, and remains login-policy valid', () => {
    const next = createForcedPasswordChangeProofState(
      createState({
        failedLoginCount: 3,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt
      }),
      transactionTime
    )

    expect(next).toEqual({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: previousLoginAt,
      updatedAt: transactionTime
    })
    expect(Object.isFrozen(next)).toBe(true)
    expect(() => evaluateLocalLoginPolicyState(next, transactionTime)).not.toThrow()
  })

  it('invalid current password uses attempts one through five and the exact lock duration', () => {
    const fourth = createForcedPasswordChangeInvalidCurrentPasswordTransition(
      createState({
        failedLoginCount: 3,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt
      }),
      transactionTime
    )
    const fifth = createForcedPasswordChangeInvalidCurrentPasswordTransition(
      createState({
        failedLoginCount: 4,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt
      }),
      transactionTime
    )

    expect(fourth).toMatchObject({
      reason: 'INVALID_CREDENTIALS',
      retryAt: null,
      lockApplied: false,
      nextState: {
        failedLoginCount: 4,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt: transactionTime
      }
    })
    expect(fifth.reason).toBe('ACCOUNT_LOCKED')
    expect(fifth.lockApplied).toBe(true)
    expect(fifth.nextState.failedLoginCount).toBe(5)
    expect(fifth.nextState.lockedUntil).toBe(
      parseUtcTimestamp(
        new Date(
          Date.parse(transactionTime) + localLoginLockDurationMinutes * 60 * 1000
        ).toISOString()
      )
    )
    expect(fifth.nextState.lastLoginAt).toBe(previousLoginAt)
  })

  it('active lock attempt preserves the lock and does not extend it', () => {
    const next = createForcedPasswordChangeActiveLockAttemptState(
      createState({
        failedLoginCount: 5,
        lockedUntil: activeLockedUntil,
        lastLoginAt: previousLoginAt,
        updatedAt
      }),
      transactionTime
    )

    expect(next).toEqual({
      failedLoginCount: 5,
      lockedUntil: activeLockedUntil,
      lastLoginAt: previousLoginAt,
      updatedAt: transactionTime
    })
  })

  it('fails closed on backward or inconsistent temporal state', () => {
    expect(() =>
      createForcedPasswordChangeProofState(
        createState({
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: previousLoginAt,
          updatedAt: transactionTime
        }),
        updatedAt
      )
    ).toThrow(LocalForcedPasswordChangeStateIntegrityError)

    expect(() =>
      createForcedPasswordChangeProofState(
        createState({
          failedLoginCount: 5,
          lockedUntil: updatedAt,
          lastLoginAt: previousLoginAt,
          updatedAt
        }),
        transactionTime
      )
    ).toThrow(LocalForcedPasswordChangeStateIntegrityError)
  })
})

function createState(
  override: Partial<LocalUserAuthenticationStateSnapshot>
): LocalUserAuthenticationStateSnapshot {
  return {
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    updatedAt,
    ...override
  }
}
