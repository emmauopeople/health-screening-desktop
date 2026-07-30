import { describe, expect, it } from 'vitest'

import {
  addLocalLoginLockDuration,
  assertNonDecreasingLocalLoginTime,
  createActiveLockAttemptState,
  createInvalidPasswordTransition,
  createSuccessfulLoginState,
  evaluateLocalLoginPolicyState,
  LocalLoginConcurrencyError,
  LocalLoginStateIntegrityError
} from '@main/application/authentication'
import type { LocalUserAuthenticationStateSnapshot } from '@main/database'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation'

const now = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const earlier = parseUtcTimestamp('2026-07-30T11:59:59.999Z')
const later = parseUtcTimestamp('2026-07-30T12:00:00.001Z')
const previousLoginAt = parseUtcTimestamp('2026-07-29T10:15:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const exactFifteenMinuteLock = parseUtcTimestamp('2026-07-30T12:15:00.000Z')

describe('local login lockout policy', () => {
  it('validates unlocked counts 0 through 4', () => {
    for (const failedLoginCount of [0, 1, 2, 3, 4]) {
      expect(evaluateLocalLoginPolicyState(createSnapshot({ failedLoginCount }), now)).toEqual({
        activeLock: false,
        expiredLock: false,
        effectiveFailedLoginCount: failedLoginCount
      })
    }
  })

  it('validates count 5 with active and expired locks', () => {
    expect(
      evaluateLocalLoginPolicyState(
        createSnapshot({ failedLoginCount: 5, lockedUntil: activeLockedUntil }),
        now
      )
    ).toEqual({
      activeLock: true,
      expiredLock: false,
      effectiveFailedLoginCount: 5
    })
    expect(
      evaluateLocalLoginPolicyState(
        createSnapshot({ failedLoginCount: 5, lockedUntil: earlier }),
        now
      )
    ).toEqual({
      activeLock: false,
      expiredLock: true,
      effectiveFailedLoginCount: 0
    })
  })

  it('rejects states outside the HSD-018 invariant set', () => {
    for (const state of [
      createSnapshot({ failedLoginCount: 6 }),
      createSnapshot({ failedLoginCount: 4, lockedUntil: activeLockedUntil }),
      createSnapshot({ failedLoginCount: 5, lockedUntil: null }),
      createSnapshot({ failedLoginCount: -1 }),
      createSnapshot({ failedLoginCount: 1.5 })
    ]) {
      expect(() => evaluateLocalLoginPolicyState(state, now)).toThrow(LocalLoginStateIntegrityError)
    }
  })

  it('increments wrong-password attempts and applies the fifth-attempt lock', () => {
    for (const failedLoginCount of [0, 1, 2, 3]) {
      const transition = createInvalidPasswordTransition(createSnapshot({ failedLoginCount }), now)

      expect(transition).toEqual({
        nextState: {
          failedLoginCount: failedLoginCount + 1,
          lockedUntil: null,
          lastLoginAt: previousLoginAt,
          updatedAt: now
        },
        reason: 'INVALID_CREDENTIALS',
        retryAt: null,
        lockApplied: false
      })
    }

    expect(createInvalidPasswordTransition(createSnapshot({ failedLoginCount: 4 }), now)).toEqual({
      nextState: {
        failedLoginCount: 5,
        lockedUntil: exactFifteenMinuteLock,
        lastLoginAt: previousLoginAt,
        updatedAt: now
      },
      reason: 'ACCOUNT_LOCKED',
      retryAt: exactFifteenMinuteLock,
      lockApplied: true
    })
  })

  it('starts a new failure cycle after an expired lock', () => {
    expect(
      createInvalidPasswordTransition(
        createSnapshot({ failedLoginCount: 5, lockedUntil: earlier }),
        now
      ).nextState
    ).toEqual({
      failedLoginCount: 1,
      lockedUntil: null,
      lastLoginAt: previousLoginAt,
      updatedAt: now
    })
  })

  it('resets successful-login state and preserves active locks without extension', () => {
    expect(createSuccessfulLoginState(createSnapshot({ failedLoginCount: 4 }), now)).toEqual({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now
    })

    expect(
      createActiveLockAttemptState(
        createSnapshot({ failedLoginCount: 5, lockedUntil: activeLockedUntil }),
        now
      )
    ).toEqual({
      failedLoginCount: 5,
      lockedUntil: activeLockedUntil,
      lastLoginAt: previousLoginAt,
      updatedAt: now
    })
  })

  it('uses canonical UTC arithmetic and rejects invalid or non-monotonic time', () => {
    expect(addLocalLoginLockDuration(now)).toBe(exactFifteenMinuteLock)
    expect(() => assertNonDecreasingLocalLoginTime(now, earlier)).toThrow(
      LocalLoginStateIntegrityError
    )
    expect(() =>
      evaluateLocalLoginPolicyState(createSnapshot({ failedLoginCount: 0 }), 'bad' as UtcTimestamp)
    ).toThrow(LocalLoginStateIntegrityError)
    expect(() =>
      createActiveLockAttemptState(createSnapshot({ failedLoginCount: 5, lockedUntil: now }), later)
    ).toThrow(LocalLoginConcurrencyError)
  })
})

function createSnapshot({
  failedLoginCount,
  lockedUntil = null,
  lastLoginAt = previousLoginAt,
  updatedAt = earlier
}: {
  readonly failedLoginCount: number
  readonly lockedUntil?: UtcTimestamp | null
  readonly lastLoginAt?: UtcTimestamp | null
  readonly updatedAt?: UtcTimestamp
}): LocalUserAuthenticationStateSnapshot {
  return Object.freeze({
    failedLoginCount,
    lockedUntil,
    lastLoginAt,
    updatedAt
  })
}
