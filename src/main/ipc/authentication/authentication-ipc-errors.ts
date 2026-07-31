import { z } from 'zod'

import {
  getLocalSessionErrorType,
  LocalSessionAuthenticationError,
  LocalSessionAuthorizationError,
  LocalSessionCompositionError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError
} from '@main/application'
import { sanitizeErrorType } from '@main/foundation/error-type'
import {
  createAuthenticationFailure,
  type AuthenticationErrorCode,
  type AuthenticationFailure,
  type AuthenticationIpcChannel
} from '@shared/ipc'

export interface AuthenticationIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export class AuthenticationIpcResponseValidationError extends Error {
  constructor() {
    super('Authentication IPC response validation failed.')
    this.name = 'AuthenticationIpcResponseValidationError'
    delete this.stack
  }
}

export function createAuthenticationIpcFailure(
  code: AuthenticationErrorCode
): AuthenticationFailure {
  return createAuthenticationFailure(code) as AuthenticationFailure
}

export function getAuthenticationIpcFailureCode(error: unknown): AuthenticationErrorCode {
  if (isSafeInstanceOf(error, LocalSessionValidationError)) {
    return 'VALIDATION_FAILED'
  }

  if (isSafeInstanceOf(error, LocalSessionOperationInProgressError)) {
    return 'AUTH_OPERATION_IN_PROGRESS'
  }

  if (isSafeInstanceOf(error, LocalSessionStateIntegrityError)) {
    return 'AUTH_STATE_INTEGRITY'
  }

  if (isSafeInstanceOf(error, LocalSessionConcurrencyError)) {
    return 'AUTH_CONCURRENCY'
  }

  if (isSafeInstanceOf(error, LocalSessionUnauthenticatedError)) {
    return 'AUTH_UNAUTHENTICATED'
  }

  if (isSafeInstanceOf(error, LocalSessionLockedError)) {
    return 'AUTH_LOCKED'
  }

  if (isSafeInstanceOf(error, LocalSessionPasswordChangeRequiredError)) {
    return 'AUTH_PASSWORD_CHANGE_REQUIRED'
  }

  if (isSafeInstanceOf(error, LocalSessionAuthorizationError)) {
    return 'AUTHORIZATION_FAILED'
  }

  if (
    isSafeInstanceOf(error, LocalSessionAuthenticationError) ||
    isSafeInstanceOf(error, LocalSessionCompositionError)
  ) {
    return 'AUTHENTICATION_UNAVAILABLE'
  }

  return 'INTERNAL_ERROR'
}

export function logAuthenticationIpcFailure(
  logger: AuthenticationIpcOperationalLogger,
  channel: AuthenticationIpcChannel,
  code: AuthenticationErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getSafeErrorType(error)}`
    const message = `IPC handler result event=authentication; channel=${channel}; code=${code}${errorType}`

    if (
      code === 'INTERNAL_ERROR' ||
      code === 'AUTH_STATE_INTEGRITY' ||
      code === 'AUTHENTICATION_UNAVAILABLE'
    ) {
      logger.error(message)
      return
    }

    logger.warn(message)
  } catch {
    // Operational logging is best-effort and must never alter the IPC result.
  }
}

function getSafeErrorType(error: unknown): string {
  try {
    if (isSafeInstanceOf(error, z.ZodError)) {
      return 'UnknownError'
    }

    const sessionErrorType = getLocalSessionErrorType(error)
    return sanitizeErrorType(sessionErrorType) ?? 'UnknownError'
  } catch {
    return 'UnknownError'
  }
}

function isSafeInstanceOf(value: unknown, constructor: { readonly prototype: object }): boolean {
  try {
    return Function.prototype[Symbol.hasInstance].call(constructor, value) as boolean
  } catch {
    return false
  }
}
