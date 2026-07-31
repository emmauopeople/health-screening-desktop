import { parseUtcTimestamp, type EntityId, type UtcTimestamp } from '@main/foundation'
import { getErrorType } from '@main/foundation/error-type'

import {
  getLocalForcedPasswordChangeErrorType,
  isLocalForcedPasswordChangeError,
  LocalForcedPasswordChangeConcurrencyError,
  LocalForcedPasswordChangeStateIntegrityError
} from '../forced-password-change-errors'
import {
  getLocalLoginErrorType,
  isLocalLoginError,
  LocalLoginConcurrencyError,
  LocalLoginStateIntegrityError
} from '../local-login-errors'
import {
  createActiveLocalSessionContext,
  createActiveLocalSessionState,
  createLockedLocalSessionState,
  createPasswordChangeRequiredLocalSessionState,
  createSignedOutLocalSessionState,
  evaluateLocalSessionDeadlines,
  refreshActiveLocalSessionActivity,
  copyLocalSessionSnapshot,
  copyLocalSessionSnapshotWithRevision
} from './local-session-policy'
import {
  getLocalSessionErrorType,
  isLocalSessionError,
  LocalSessionAuthenticationError,
  LocalSessionAuthorizationError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError,
  rebuildLocalSessionError
} from './local-session-errors'
import {
  parseCredentialFreeLocalSessionUser,
  parseLocalSessionPasswordChangeInput,
  parseLocalSessionRoleList,
  parseLocalSessionUnlockInput
} from './local-session-validation'
import type {
  ActiveLocalSessionContext,
  LocalAuthenticationSessionService,
  LocalAuthenticationSessionServiceDependencies,
  LocalSessionLoginResult,
  LocalSessionPasswordChangeResult,
  LocalSessionSnapshot,
  LocalSessionState,
  LocalSessionUnlockResult,
  ParsedLocalSessionPasswordChangeInput,
  ParsedLocalSessionUnlockInput
} from './local-session-types'

type AuthenticationOperationKind = 'LOGIN' | 'PASSWORD_CHANGE' | 'UNLOCK'

interface PendingAuthenticationOperation {
  readonly id: number
  readonly kind: AuthenticationOperationKind
  readonly revision: number
  readonly userId?: EntityId
}

export function createLocalAuthenticationSessionService({
  loginService,
  forcedPasswordChangeService,
  clock
}: LocalAuthenticationSessionServiceDependencies): LocalAuthenticationSessionService {
  let state: LocalSessionState = createSignedOutLocalSessionState()
  let pendingOperation: PendingAuthenticationOperation | undefined
  let operationSequence = 0
  let lastTransitionAt: UtcTimestamp | undefined

  const service: LocalAuthenticationSessionService = Object.freeze({
    async login(input: unknown): Promise<LocalSessionLoginResult> {
      const marker = beginLoginOperation()

      try {
        const result = await loginService.authenticate(input)
        evaluateDeadlines()
        assertOperationCurrent(marker)
        assertStateForLogin(marker)

        if (result.status === 'REJECTED') {
          finishOperation(marker)

          return freezeLoginRejectedResult(result.reason, result.retryAt)
        }

        const user = parseCredentialFreeLocalSessionUser(result.user)
        const currentTime = readSessionTime()
        assertOperationCurrent(marker)
        assertStateForLogin(marker)

        if (!user.isActive) {
          throw new LocalSessionStateIntegrityError()
        }

        if (user.mustChangePassword) {
          state = createPasswordChangeRequiredLocalSessionState({
            user,
            establishedAt: currentTime,
            revision: nextRevision()
          })
          lastTransitionAt = currentTime
          finishOperation(marker)

          return Object.freeze({
            status: 'PASSWORD_CHANGE_REQUIRED' as const,
            session: copyLocalSessionSnapshot(state) as Extract<
              LocalSessionSnapshot,
              { readonly status: 'PASSWORD_CHANGE_REQUIRED' }
            >
          })
        }

        state = createActiveLocalSessionState({
          user,
          authenticatedAt: currentTime,
          revision: nextRevision()
        })
        lastTransitionAt = currentTime
        finishOperation(marker)

        return Object.freeze({
          status: 'ACTIVE' as const,
          session: copyLocalSessionSnapshot(state) as Extract<
            LocalSessionSnapshot,
            { readonly status: 'ACTIVE' }
          >
        })
      } catch (error) {
        throw toLoginSessionBoundaryError(error)
      } finally {
        finishOperation(marker)
      }
    },

    async changeRequiredPassword(input: unknown): Promise<LocalSessionPasswordChangeResult> {
      let parsedInput: ParsedLocalSessionPasswordChangeInput | undefined
      const marker = beginPasswordChangeOperation()

      try {
        parsedInput = parseLocalSessionPasswordChangeInput(input)
        const provisionalUserId = marker.userId

        if (provisionalUserId === undefined) {
          throw new LocalSessionStateIntegrityError()
        }

        const result = await forcedPasswordChangeService.changePassword({
          userId: provisionalUserId,
          currentPassword: parsedInput.currentPassword,
          newPassword: parsedInput.newPassword,
          confirmNewPassword: parsedInput.confirmNewPassword
        })

        evaluateDeadlines()
        assertOperationCurrent(marker)
        assertStateForPasswordChange(marker)

        if (result.status === 'REJECTED') {
          if (
            result.reason === 'ACCOUNT_INACTIVE' ||
            result.reason === 'PASSWORD_CHANGE_NOT_REQUIRED'
          ) {
            invalidateToSignedOut(readSessionTime())
          }

          finishOperation(marker)

          return freezePasswordChangeRejectedResult(result.reason, result.retryAt)
        }

        const user = parseCredentialFreeLocalSessionUser(result.user)
        const currentState = state

        if (
          currentState.status !== 'PASSWORD_CHANGE_REQUIRED' ||
          user.id !== currentState.user.id ||
          !user.isActive ||
          user.mustChangePassword ||
          user.username !== currentState.user.username ||
          user.displayName !== currentState.user.displayName ||
          user.role !== currentState.user.role ||
          user.createdAt !== currentState.user.createdAt
        ) {
          invalidateToSignedOut(readSessionTime())
          throw new LocalSessionConcurrencyError()
        }

        const currentTime = readSessionTime()
        assertOperationCurrent(marker)
        assertStateForPasswordChange(marker)
        state = createActiveLocalSessionState({
          user,
          authenticatedAt: currentTime,
          revision: nextRevision()
        })
        lastTransitionAt = currentTime
        finishOperation(marker)

        return Object.freeze({
          status: 'ACTIVE' as const,
          session: copyLocalSessionSnapshot(state) as Extract<
            LocalSessionSnapshot,
            { readonly status: 'ACTIVE' }
          >
        })
      } catch (error) {
        if (
          error instanceof LocalForcedPasswordChangeConcurrencyError ||
          error instanceof LocalForcedPasswordChangeStateIntegrityError
        ) {
          state = createSignedOutLocalSessionState(nextRevision())
          pendingOperation = undefined
        }

        throw toPasswordChangeSessionBoundaryError(error)
      } finally {
        parsedInput = undefined
        finishOperation(marker)
      }
    },

    async unlock(input: unknown): Promise<LocalSessionUnlockResult> {
      let parsedInput: ParsedLocalSessionUnlockInput | undefined
      const marker = beginUnlockOperation()

      try {
        parsedInput = parseLocalSessionUnlockInput(input)
        const lockedState = state

        if (lockedState.status !== 'LOCKED') {
          throw new LocalSessionStateIntegrityError()
        }

        const result = await loginService.authenticate({
          username: lockedState.user.username,
          password: parsedInput.password
        })

        evaluateDeadlines()
        assertOperationCurrent(marker)
        assertStateForUnlock(marker)

        if (result.status === 'REJECTED') {
          finishOperation(marker)

          return freezeUnlockRejectedResult(result.reason, result.retryAt)
        }

        const user = parseCredentialFreeLocalSessionUser(result.user)
        const currentState = state

        if (
          currentState.status !== 'LOCKED' ||
          user.id !== currentState.user.id ||
          user.username !== currentState.user.username ||
          user.displayName !== currentState.user.displayName ||
          user.role !== currentState.user.role ||
          user.createdAt !== currentState.user.createdAt ||
          !user.isActive ||
          user.mustChangePassword ||
          user.failedLoginCount !== 0 ||
          user.lockedUntil !== null
        ) {
          invalidateToSignedOut(readSessionTime())
          throw new LocalSessionConcurrencyError()
        }

        const currentTime = readSessionTime()
        assertOperationCurrent(marker)
        assertStateForUnlock(marker)
        state = createActiveLocalSessionState({
          user,
          authenticatedAt: currentTime,
          revision: nextRevision()
        })
        lastTransitionAt = currentTime
        finishOperation(marker)

        return Object.freeze({
          status: 'ACTIVE' as const,
          session: copyLocalSessionSnapshot(state) as Extract<
            LocalSessionSnapshot,
            { readonly status: 'ACTIVE' }
          >
        })
      } catch (error) {
        if (
          error instanceof LocalLoginConcurrencyError ||
          error instanceof LocalLoginStateIntegrityError
        ) {
          state = createSignedOutLocalSessionState(nextRevision())
          pendingOperation = undefined
        }

        throw toUnlockSessionBoundaryError(error)
      } finally {
        parsedInput = undefined
        finishOperation(marker)
      }
    },

    getSnapshot(): LocalSessionSnapshot {
      evaluateDeadlines()

      return copyLocalSessionSnapshot(state)
    },

    recordActivity(): LocalSessionSnapshot {
      const currentTime = evaluateDeadlines()

      if (pendingOperation !== undefined) {
        throw new LocalSessionOperationInProgressError()
      }

      if (state.status !== 'ACTIVE') {
        throwStateAccessError(state)
      }

      state = refreshActiveLocalSessionActivity({
        state,
        activityAt: currentTime,
        revision: nextRevision()
      })
      lastTransitionAt = currentTime

      return copyLocalSessionSnapshot(state)
    },

    lock(): LocalSessionSnapshot {
      const currentTime = evaluateDeadlines()

      if (pendingOperation !== undefined) {
        state = copyLocalSessionSnapshotWithRevision(state, nextRevision())
        pendingOperation = undefined
        lastTransitionAt = currentTime

        if (state.status === 'SIGNED_OUT' || state.status === 'PASSWORD_CHANGE_REQUIRED') {
          throwStateAccessError(state)
        }

        return copyLocalSessionSnapshot(state)
      }

      if (state.status === 'ACTIVE') {
        state = createLockedLocalSessionState({
          state,
          lockedAt: currentTime,
          reason: 'MANUAL',
          revision: nextRevision()
        })
        pendingOperation = undefined
        lastTransitionAt = currentTime

        return copyLocalSessionSnapshot(state)
      }

      if (state.status === 'LOCKED') {
        return copyLocalSessionSnapshot(state)
      }

      throwStateAccessError(state)
    },

    logout(): LocalSessionSnapshot {
      state = createSignedOutLocalSessionState(nextRevision())
      pendingOperation = undefined

      return copyLocalSessionSnapshot(state)
    },

    requireActiveSession(): ActiveLocalSessionContext {
      evaluateDeadlines()

      if (state.status !== 'ACTIVE') {
        throwStateAccessError(state)
      }

      return createActiveLocalSessionContext(state)
    },

    requireAnyRole(roles: unknown): ActiveLocalSessionContext {
      const context = service.requireActiveSession()
      const parsedRoles = parseLocalSessionRoleList(roles)

      if (!parsedRoles.includes(context.user.role)) {
        throw new LocalSessionAuthorizationError()
      }

      return context
    }
  })

  return service

  function beginLoginOperation(): PendingAuthenticationOperation {
    evaluateDeadlines()
    ensureNoPendingOperation()

    if (state.status !== 'SIGNED_OUT') {
      throwStateAccessError(state)
    }

    return setPendingOperation('LOGIN')
  }

  function beginPasswordChangeOperation(): PendingAuthenticationOperation {
    evaluateDeadlines()
    ensureNoPendingOperation()

    if (state.status !== 'PASSWORD_CHANGE_REQUIRED') {
      throwStateAccessError(state)
    }

    return setPendingOperation('PASSWORD_CHANGE', state.user.id)
  }

  function beginUnlockOperation(): PendingAuthenticationOperation {
    evaluateDeadlines()
    ensureNoPendingOperation()

    if (state.status !== 'LOCKED') {
      throwStateAccessError(state)
    }

    return setPendingOperation('UNLOCK', state.user.id)
  }

  function setPendingOperation(
    kind: AuthenticationOperationKind,
    userId?: EntityId
  ): PendingAuthenticationOperation {
    operationSequence += 1
    const operation = Object.freeze({
      id: operationSequence,
      kind,
      revision: state.revision,
      userId
    })
    pendingOperation = operation

    return operation
  }

  function ensureNoPendingOperation(): void {
    if (pendingOperation !== undefined) {
      throw new LocalSessionOperationInProgressError()
    }
  }

  function finishOperation(marker: PendingAuthenticationOperation): void {
    if (pendingOperation?.id === marker.id) {
      pendingOperation = undefined
    }
  }

  function assertOperationCurrent(marker: PendingAuthenticationOperation): void {
    const operation = pendingOperation

    if (
      operation === undefined ||
      operation.id !== marker.id ||
      operation.kind !== marker.kind ||
      operation.revision !== marker.revision ||
      state.revision !== marker.revision
    ) {
      throw new LocalSessionConcurrencyError()
    }
  }

  function assertStateForLogin(marker: PendingAuthenticationOperation): void {
    if (marker.kind !== 'LOGIN' || state.status !== 'SIGNED_OUT') {
      throw new LocalSessionConcurrencyError()
    }
  }

  function assertStateForPasswordChange(marker: PendingAuthenticationOperation): void {
    if (
      marker.kind !== 'PASSWORD_CHANGE' ||
      state.status !== 'PASSWORD_CHANGE_REQUIRED' ||
      marker.userId === undefined ||
      state.user.id !== marker.userId
    ) {
      throw new LocalSessionConcurrencyError()
    }
  }

  function assertStateForUnlock(marker: PendingAuthenticationOperation): void {
    if (
      marker.kind !== 'UNLOCK' ||
      state.status !== 'LOCKED' ||
      marker.userId === undefined ||
      state.user.id !== marker.userId
    ) {
      throw new LocalSessionConcurrencyError()
    }
  }

  function evaluateDeadlines(): UtcTimestamp {
    const currentTime = readSessionTime()
    const evaluation = evaluateLocalSessionDeadlines({
      state,
      currentTime,
      nextRevision: nextRevision()
    })

    if (evaluation.transitioned) {
      state = evaluation.state
      pendingOperation = undefined
      lastTransitionAt = currentTime
    }

    return currentTime
  }

  function readSessionTime(): UtcTimestamp {
    let currentTime: UtcTimestamp

    try {
      currentTime = parseUtcTimestamp(clock.now())
    } catch (error) {
      throw new LocalSessionStateIntegrityError(getErrorType(error))
    }

    if (lastTransitionAt !== undefined && currentTime < lastTransitionAt) {
      if (state.status !== 'SIGNED_OUT') {
        state = createSignedOutLocalSessionState(nextRevision())
        pendingOperation = undefined
      }

      throw new LocalSessionStateIntegrityError('UtcClockError')
    }

    return currentTime
  }

  function invalidateToSignedOut(currentTime: UtcTimestamp): void {
    state = createSignedOutLocalSessionState(nextRevision())
    pendingOperation = undefined
    lastTransitionAt = currentTime
  }

  function nextRevision(): number {
    const revision = state.revision + 1

    if (!Number.isSafeInteger(revision)) {
      throw new LocalSessionStateIntegrityError()
    }

    return revision
  }
}

function freezeLoginRejectedResult(
  reason: Extract<LocalSessionLoginResult, { readonly status: 'REJECTED' }>['reason'],
  retryAt: UtcTimestamp | null
): Extract<LocalSessionLoginResult, { readonly status: 'REJECTED' }> {
  return Object.freeze({
    status: 'REJECTED' as const,
    reason,
    retryAt
  })
}

function freezePasswordChangeRejectedResult(
  reason: Extract<LocalSessionPasswordChangeResult, { readonly status: 'REJECTED' }>['reason'],
  retryAt: UtcTimestamp | null
): Extract<LocalSessionPasswordChangeResult, { readonly status: 'REJECTED' }> {
  return Object.freeze({
    status: 'REJECTED' as const,
    reason,
    retryAt
  })
}

function freezeUnlockRejectedResult(
  reason: Extract<LocalSessionUnlockResult, { readonly status: 'REJECTED' }>['reason'],
  retryAt: UtcTimestamp | null
): Extract<LocalSessionUnlockResult, { readonly status: 'REJECTED' }> {
  return Object.freeze({
    status: 'REJECTED' as const,
    reason,
    retryAt
  })
}

function throwStateAccessError(state: LocalSessionState): never {
  if (state.status === 'SIGNED_OUT') {
    throw new LocalSessionUnauthenticatedError()
  }

  if (state.status === 'PASSWORD_CHANGE_REQUIRED') {
    throw new LocalSessionPasswordChangeRequiredError()
  }

  if (state.status === 'LOCKED') {
    throw new LocalSessionLockedError()
  }

  throw new LocalSessionStateIntegrityError()
}

function toLoginSessionBoundaryError(error: unknown): Error {
  if (isLocalSessionError(error)) {
    return rebuildLocalSessionError(error)
  }

  if (isLocalLoginError(error)) {
    if (error.name === 'LocalLoginValidationError') {
      return new LocalSessionValidationError(getLocalLoginErrorType(error))
    }

    if (error instanceof LocalLoginConcurrencyError) {
      return new LocalSessionConcurrencyError(getLocalLoginErrorType(error))
    }

    if (error instanceof LocalLoginStateIntegrityError) {
      return new LocalSessionStateIntegrityError(getLocalLoginErrorType(error))
    }

    return new LocalSessionAuthenticationError(getLocalLoginErrorType(error))
  }

  return new LocalSessionAuthenticationError(getErrorType(error))
}

function toPasswordChangeSessionBoundaryError(error: unknown): Error {
  if (isLocalSessionError(error)) {
    return rebuildLocalSessionError(error)
  }

  if (isLocalForcedPasswordChangeError(error)) {
    if (error.name === 'LocalForcedPasswordChangeValidationError') {
      return new LocalSessionValidationError(getLocalForcedPasswordChangeErrorType(error))
    }

    if (error instanceof LocalForcedPasswordChangeConcurrencyError) {
      return new LocalSessionConcurrencyError(getLocalForcedPasswordChangeErrorType(error))
    }

    if (error instanceof LocalForcedPasswordChangeStateIntegrityError) {
      return new LocalSessionStateIntegrityError(getLocalForcedPasswordChangeErrorType(error))
    }

    return new LocalSessionAuthenticationError(getLocalForcedPasswordChangeErrorType(error))
  }

  return new LocalSessionAuthenticationError(getErrorType(error))
}

function toUnlockSessionBoundaryError(error: unknown): Error {
  if (isLocalSessionError(error)) {
    return rebuildLocalSessionError(error)
  }

  if (isLocalLoginError(error)) {
    if (error.name === 'LocalLoginValidationError') {
      return new LocalSessionValidationError(getLocalLoginErrorType(error))
    }

    if (error instanceof LocalLoginConcurrencyError) {
      return new LocalSessionConcurrencyError(getLocalLoginErrorType(error))
    }

    if (error instanceof LocalLoginStateIntegrityError) {
      return new LocalSessionStateIntegrityError(getLocalLoginErrorType(error))
    }

    return new LocalSessionAuthenticationError(getLocalLoginErrorType(error))
  }

  return new LocalSessionAuthenticationError(getErrorType(error))
}

export function getLocalSessionBoundaryErrorType(error: unknown): string {
  return getLocalSessionErrorType(error)
}
