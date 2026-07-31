import { describe, expect, it } from 'vitest'

import {
  addUtcMilliseconds,
  assertLocalSessionStateInvariants,
  assertNonBackwardLocalSessionTime,
  createActiveLocalSessionContext,
  createActiveLocalSessionState,
  createLockedLocalSessionState,
  createPasswordChangeRequiredLocalSessionState,
  createSignedOutLocalSessionState,
  evaluateLocalSessionDeadlines,
  localSessionAbsoluteLifetimeMilliseconds,
  localSessionIdleTimeoutMilliseconds,
  localSessionPasswordChangeContextMilliseconds,
  LocalSessionStateIntegrityError,
  refreshActiveLocalSessionActivity
} from '@main/application'
import {
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  type LocalUserRecord
} from '@main/database'
import { parseEntityId, parseUtcTimestamp } from '@main/foundation'

const authenticatedAt = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const idleExpiresAt = parseUtcTimestamp('2026-07-30T12:15:00.000Z')
const absoluteExpiresAt = parseUtcTimestamp('2026-07-31T00:00:00.000Z')
const activityAt = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const refreshedIdleExpiresAt = parseUtcTimestamp('2026-07-30T12:25:00.000Z')

describe('local session policy', () => {
  it('creates frozen signed-out, password-change, and active states with exact deadlines', () => {
    const signedOut = createSignedOutLocalSessionState()
    const passwordChange = createPasswordChangeRequiredLocalSessionState({
      user: createUser({ mustChangePassword: true }),
      establishedAt: authenticatedAt,
      revision: 1
    })
    const active = createActiveLocalSessionState({
      user: createUser(),
      authenticatedAt,
      revision: 2
    })

    expect(signedOut).toEqual({ status: 'SIGNED_OUT', revision: 0 })
    expect(passwordChange.expiresAt).toBe(
      addUtcMilliseconds(authenticatedAt, localSessionPasswordChangeContextMilliseconds)
    )
    expect(active.idleExpiresAt).toBe(idleExpiresAt)
    expect(active.absoluteExpiresAt).toBe(absoluteExpiresAt)
    expect(Object.isFrozen(passwordChange)).toBe(true)
    expect(Object.isFrozen(passwordChange.user)).toBe(true)
    expect(Object.isFrozen(active)).toBe(true)
    expect(Object.isFrozen(active.user)).toBe(true)
  })

  it('evaluates idle and absolute deadlines at exact boundaries', () => {
    const active = createActiveLocalSessionState({
      user: createUser(),
      authenticatedAt,
      revision: 1
    })

    expect(
      evaluateLocalSessionDeadlines({
        state: active,
        currentTime: parseUtcTimestamp('2026-07-30T12:14:59.999Z'),
        nextRevision: 2
      }).state.status
    ).toBe('ACTIVE')

    const idle = evaluateLocalSessionDeadlines({
      state: active,
      currentTime: idleExpiresAt,
      nextRevision: 2
    }).state

    expect(idle).toMatchObject({
      status: 'LOCKED',
      lockedAt: idleExpiresAt,
      reason: 'IDLE_TIMEOUT',
      revision: 2
    })

    const absolute = evaluateLocalSessionDeadlines({
      state: active,
      currentTime: absoluteExpiresAt,
      nextRevision: 2
    }).state

    expect(absolute).toEqual({ status: 'SIGNED_OUT', revision: 2 })
  })

  it('expires locked and provisional states lazily', () => {
    const active = createActiveLocalSessionState({
      user: createUser(),
      authenticatedAt,
      revision: 1
    })
    const locked = createLockedLocalSessionState({
      state: active,
      lockedAt: idleExpiresAt,
      reason: 'MANUAL',
      revision: 2
    })
    const provisional = createPasswordChangeRequiredLocalSessionState({
      user: createUser({ mustChangePassword: true }),
      establishedAt: authenticatedAt,
      revision: 3
    })

    expect(
      evaluateLocalSessionDeadlines({
        state: locked,
        currentTime: absoluteExpiresAt,
        nextRevision: 4
      }).state
    ).toEqual({ status: 'SIGNED_OUT', revision: 4 })
    expect(
      evaluateLocalSessionDeadlines({
        state: provisional,
        currentTime: idleExpiresAt,
        nextRevision: 4
      }).state
    ).toEqual({ status: 'SIGNED_OUT', revision: 4 })
  })

  it('activity extends only idle expiry and keeps the absolute lifetime', () => {
    const active = createActiveLocalSessionState({
      user: createUser(),
      authenticatedAt,
      revision: 1
    })
    const refreshed = refreshActiveLocalSessionActivity({
      state: active,
      activityAt,
      revision: 2
    })

    expect(refreshed.authenticatedAt).toBe(authenticatedAt)
    expect(refreshed.lastActivityAt).toBe(activityAt)
    expect(refreshed.idleExpiresAt).toBe(refreshedIdleExpiresAt)
    expect(refreshed.absoluteExpiresAt).toBe(absoluteExpiresAt)
  })

  it('returns frozen active contexts without treating revision as authority', () => {
    const active = createActiveLocalSessionState({
      user: createUser(),
      authenticatedAt,
      revision: 7
    })
    const context = createActiveLocalSessionContext(active)

    expect(context).not.toHaveProperty('revision')
    expect(context.user).toEqual(active.user)
    expect(context.user).not.toBe(active.user)
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.user)).toBe(true)
  })

  it('rejects backward time, overflow, and invalid state invariants', () => {
    expect(() => assertNonBackwardLocalSessionTime(authenticatedAt, activityAt)).not.toThrow()
    expect(() => assertNonBackwardLocalSessionTime(activityAt, authenticatedAt)).toThrow(
      LocalSessionStateIntegrityError
    )
    expect(() => addUtcMilliseconds(parseUtcTimestamp('9999-12-31T23:59:59.999Z'), 1)).toThrow(
      LocalSessionStateIntegrityError
    )
    expect(() =>
      createActiveLocalSessionState({
        user: createUser({ mustChangePassword: true }),
        authenticatedAt,
        revision: 1
      })
    ).toThrow(LocalSessionStateIntegrityError)
    expect(() =>
      assertLocalSessionStateInvariants({
        ...createSignedOutLocalSessionState(),
        revision: -1
      })
    ).toThrow(LocalSessionStateIntegrityError)
  })

  it('exports exact timeout constants as milliseconds', () => {
    expect(localSessionIdleTimeoutMilliseconds).toBe(15 * 60 * 1000)
    expect(localSessionPasswordChangeContextMilliseconds).toBe(15 * 60 * 1000)
    expect(localSessionAbsoluteLifetimeMilliseconds).toBe(12 * 60 * 60 * 1000)
  })
})

function createUser(override: Partial<LocalUserRecord> = {}): LocalUserRecord {
  return Object.freeze({
    id: parseEntityId('11111111-1111-4111-8111-111111111111'),
    username: parseUsernameIdentity('Admin.User').username,
    displayName: parseUserDisplayName('Admin User'),
    role: parseLocalUserRole('LOCAL_ADMIN'),
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: authenticatedAt,
    createdAt: parseUtcTimestamp('2026-07-30T09:00:00.000Z'),
    updatedAt: authenticatedAt,
    ...override
  })
}
