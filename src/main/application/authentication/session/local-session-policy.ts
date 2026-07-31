import type { LocalUserRecord } from '@main/database'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation'

import { LocalSessionStateIntegrityError } from './local-session-errors'
import type {
  ActiveLocalSessionContext,
  ActiveLocalSessionSnapshot,
  LocalSessionLockReason,
  LocalSessionSnapshot,
  LocalSessionState,
  PasswordChangeRequiredLocalSessionSnapshot
} from './local-session-types'

export const localSessionIdleTimeoutMinutes = 15
export const localSessionAbsoluteLifetimeHours = 12
export const localSessionPasswordChangeContextMinutes = 15

export const localSessionIdleTimeoutMilliseconds = localSessionIdleTimeoutMinutes * 60 * 1000
export const localSessionAbsoluteLifetimeMilliseconds =
  localSessionAbsoluteLifetimeHours * 60 * 60 * 1000
export const localSessionPasswordChangeContextMilliseconds =
  localSessionPasswordChangeContextMinutes * 60 * 1000

export interface LocalSessionDeadlineEvaluation {
  readonly state: LocalSessionSnapshot
  readonly transitioned: boolean
}

export function createSignedOutLocalSessionState(revision = 0): LocalSessionSnapshot {
  assertSafeRevision(revision)

  return Object.freeze({
    status: 'SIGNED_OUT' as const,
    revision
  })
}

export function createPasswordChangeRequiredLocalSessionState({
  user,
  establishedAt,
  revision
}: {
  readonly user: LocalUserRecord
  readonly establishedAt: UtcTimestamp
  readonly revision: number
}): PasswordChangeRequiredLocalSessionSnapshot {
  assertSafeRevision(revision)

  if (!user.isActive || !user.mustChangePassword) {
    throw new LocalSessionStateIntegrityError()
  }

  const state = Object.freeze({
    status: 'PASSWORD_CHANGE_REQUIRED' as const,
    user: copyLocalUserRecord(user),
    establishedAt,
    expiresAt: addUtcMilliseconds(establishedAt, localSessionPasswordChangeContextMilliseconds),
    revision
  })

  assertLocalSessionStateInvariants(state)

  return state
}

export function createActiveLocalSessionState({
  user,
  authenticatedAt,
  revision
}: {
  readonly user: LocalUserRecord
  readonly authenticatedAt: UtcTimestamp
  readonly revision: number
}): ActiveLocalSessionSnapshot {
  assertSafeRevision(revision)

  if (!user.isActive || user.mustChangePassword) {
    throw new LocalSessionStateIntegrityError()
  }

  const state = Object.freeze({
    status: 'ACTIVE' as const,
    user: copyLocalUserRecord(user),
    authenticatedAt,
    lastActivityAt: authenticatedAt,
    idleExpiresAt: addUtcMilliseconds(authenticatedAt, localSessionIdleTimeoutMilliseconds),
    absoluteExpiresAt: addUtcMilliseconds(
      authenticatedAt,
      localSessionAbsoluteLifetimeMilliseconds
    ),
    revision
  })

  assertLocalSessionStateInvariants(state)

  return state
}

export function refreshActiveLocalSessionActivity({
  state,
  activityAt,
  revision
}: {
  readonly state: ActiveLocalSessionSnapshot
  readonly activityAt: UtcTimestamp
  readonly revision: number
}): ActiveLocalSessionSnapshot {
  assertSafeRevision(revision)

  const refreshed = Object.freeze({
    status: 'ACTIVE' as const,
    user: copyLocalUserRecord(state.user),
    authenticatedAt: state.authenticatedAt,
    lastActivityAt: activityAt,
    idleExpiresAt: addUtcMilliseconds(activityAt, localSessionIdleTimeoutMilliseconds),
    absoluteExpiresAt: state.absoluteExpiresAt,
    revision
  })

  assertLocalSessionStateInvariants(refreshed)

  return refreshed
}

export function createLockedLocalSessionState({
  state,
  lockedAt,
  reason,
  revision
}: {
  readonly state: ActiveLocalSessionSnapshot
  readonly lockedAt: UtcTimestamp
  readonly reason: LocalSessionLockReason
  readonly revision: number
}): LocalSessionSnapshot {
  assertSafeRevision(revision)

  const locked = Object.freeze({
    status: 'LOCKED' as const,
    user: copyLocalUserRecord(state.user),
    authenticatedAt: state.authenticatedAt,
    lockedAt,
    absoluteExpiresAt: state.absoluteExpiresAt,
    reason,
    revision
  })

  assertLocalSessionStateInvariants(locked)

  return locked
}

export function evaluateLocalSessionDeadlines({
  state,
  currentTime,
  nextRevision
}: {
  readonly state: LocalSessionState
  readonly currentTime: UtcTimestamp
  readonly nextRevision: number
}): LocalSessionDeadlineEvaluation {
  assertLocalSessionStateInvariants(state)
  assertSafeRevision(nextRevision)

  if (state.status === 'ACTIVE') {
    if (currentTime >= state.absoluteExpiresAt) {
      return Object.freeze({
        state: createSignedOutLocalSessionState(nextRevision),
        transitioned: true
      })
    }

    if (currentTime >= state.idleExpiresAt) {
      return Object.freeze({
        state: createLockedLocalSessionState({
          state,
          lockedAt: currentTime,
          reason: 'IDLE_TIMEOUT',
          revision: nextRevision
        }),
        transitioned: true
      })
    }
  }

  if (state.status === 'LOCKED' && currentTime >= state.absoluteExpiresAt) {
    return Object.freeze({
      state: createSignedOutLocalSessionState(nextRevision),
      transitioned: true
    })
  }

  if (state.status === 'PASSWORD_CHANGE_REQUIRED' && currentTime >= state.expiresAt) {
    return Object.freeze({
      state: createSignedOutLocalSessionState(nextRevision),
      transitioned: true
    })
  }

  return Object.freeze({
    state: copyLocalSessionSnapshot(state),
    transitioned: false
  })
}

export function copyLocalSessionSnapshot(state: LocalSessionState): LocalSessionSnapshot {
  assertLocalSessionStateInvariants(state)

  if (state.status === 'SIGNED_OUT') {
    return createSignedOutLocalSessionState(state.revision)
  }

  if (state.status === 'PASSWORD_CHANGE_REQUIRED') {
    const snapshot = Object.freeze({
      status: 'PASSWORD_CHANGE_REQUIRED' as const,
      user: copyLocalUserRecord(state.user),
      establishedAt: state.establishedAt,
      expiresAt: state.expiresAt,
      revision: state.revision
    })
    assertLocalSessionStateInvariants(snapshot)

    return snapshot
  }

  if (state.status === 'ACTIVE') {
    const snapshot = Object.freeze({
      status: 'ACTIVE' as const,
      user: copyLocalUserRecord(state.user),
      authenticatedAt: state.authenticatedAt,
      lastActivityAt: state.lastActivityAt,
      idleExpiresAt: state.idleExpiresAt,
      absoluteExpiresAt: state.absoluteExpiresAt,
      revision: state.revision
    })
    assertLocalSessionStateInvariants(snapshot)

    return snapshot
  }

  const snapshot = Object.freeze({
    status: 'LOCKED' as const,
    user: copyLocalUserRecord(state.user),
    authenticatedAt: state.authenticatedAt,
    lockedAt: state.lockedAt,
    absoluteExpiresAt: state.absoluteExpiresAt,
    reason: state.reason,
    revision: state.revision
  })
  assertLocalSessionStateInvariants(snapshot)

  return snapshot
}

export function createActiveLocalSessionContext(
  state: ActiveLocalSessionSnapshot
): ActiveLocalSessionContext {
  assertLocalSessionStateInvariants(state)

  return Object.freeze({
    user: copyLocalUserRecord(state.user),
    authenticatedAt: state.authenticatedAt,
    lastActivityAt: state.lastActivityAt,
    idleExpiresAt: state.idleExpiresAt,
    absoluteExpiresAt: state.absoluteExpiresAt
  })
}

export function addUtcMilliseconds(
  start: UtcTimestamp,
  durationMilliseconds: number
): UtcTimestamp {
  if (
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds <= 0 ||
    durationMilliseconds > Number.MAX_SAFE_INTEGER
  ) {
    throw new LocalSessionStateIntegrityError()
  }

  const startMilliseconds = Date.parse(start)
  const deadlineMilliseconds = startMilliseconds + durationMilliseconds

  if (
    !Number.isFinite(startMilliseconds) ||
    !Number.isSafeInteger(deadlineMilliseconds) ||
    deadlineMilliseconds <= startMilliseconds
  ) {
    throw new LocalSessionStateIntegrityError()
  }

  try {
    return parseUtcTimestamp(new Date(deadlineMilliseconds).toISOString())
  } catch {
    throw new LocalSessionStateIntegrityError()
  }
}

export function assertNonBackwardLocalSessionTime(
  previousTime: UtcTimestamp | undefined,
  currentTime: UtcTimestamp
): void {
  if (previousTime !== undefined && currentTime < previousTime) {
    throw new LocalSessionStateIntegrityError('UtcClockError')
  }
}

export function assertLocalSessionStateInvariants(state: LocalSessionState): void {
  if (state.status === 'SIGNED_OUT') {
    assertSafeRevision(state.revision)
    return
  }

  assertCredentialFreeUserState(state.user)
  assertSafeRevision(state.revision)

  if (state.status === 'PASSWORD_CHANGE_REQUIRED') {
    if (
      !state.user.isActive ||
      !state.user.mustChangePassword ||
      state.expiresAt !==
        addUtcMilliseconds(state.establishedAt, localSessionPasswordChangeContextMilliseconds)
    ) {
      throw new LocalSessionStateIntegrityError()
    }

    return
  }

  if (state.status === 'ACTIVE') {
    if (
      !state.user.isActive ||
      state.user.mustChangePassword ||
      state.lastActivityAt < state.authenticatedAt ||
      state.idleExpiresAt !==
        addUtcMilliseconds(state.lastActivityAt, localSessionIdleTimeoutMilliseconds) ||
      state.absoluteExpiresAt !==
        addUtcMilliseconds(state.authenticatedAt, localSessionAbsoluteLifetimeMilliseconds)
    ) {
      throw new LocalSessionStateIntegrityError()
    }

    return
  }

  if (
    !state.user.isActive ||
    state.user.mustChangePassword ||
    state.lockedAt < state.authenticatedAt ||
    state.absoluteExpiresAt !==
      addUtcMilliseconds(state.authenticatedAt, localSessionAbsoluteLifetimeMilliseconds)
  ) {
    throw new LocalSessionStateIntegrityError()
  }
}

function copyLocalUserRecord(user: LocalUserRecord): LocalUserRecord {
  return Object.freeze({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  })
}

function assertCredentialFreeUserState(user: LocalUserRecord): void {
  if (typeof user !== 'object' || user === null) {
    throw new LocalSessionStateIntegrityError()
  }

  const candidate = user as unknown as Record<PropertyKey, unknown>

  if ('credential' in candidate || 'passwordHash' in candidate || 'passwordSalt' in candidate) {
    throw new LocalSessionStateIntegrityError()
  }
}

function assertSafeRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new LocalSessionStateIntegrityError()
  }
}
