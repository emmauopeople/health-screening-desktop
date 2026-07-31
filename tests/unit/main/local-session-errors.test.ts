import { describe, expect, it } from 'vitest'

import {
  getLocalSessionErrorType,
  isLocalSessionError,
  LocalSessionAuthenticationError,
  LocalSessionAuthorizationError,
  LocalSessionCompositionError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError,
  rebuildLocalSessionError
} from '@main/application'

describe('local session errors', () => {
  it('uses stable codes, fixed messages, sanitized types, and no stack', () => {
    const errors = [
      new LocalSessionValidationError('C:\\secret\\password.txt'),
      new LocalSessionStateIntegrityError('UtcClockError'),
      new LocalSessionOperationInProgressError('Error'),
      new LocalSessionConcurrencyError('LocalLoginConcurrencyError'),
      new LocalSessionUnauthenticatedError('Error'),
      new LocalSessionLockedError('Error'),
      new LocalSessionPasswordChangeRequiredError('Error'),
      new LocalSessionAuthorizationError('Error'),
      new LocalSessionAuthenticationError('LocalForcedPasswordChangePersistenceError'),
      new LocalSessionCompositionError('SqliteError')
    ]

    for (const error of errors) {
      expect(isLocalSessionError(error)).toBe(true)
      expect(error.code).toMatch(/^LOCAL_SESSION_/)
      expect(error.message).not.toContain('secret')
      expect(error.stack).toBeUndefined()
      expect(error.errorType).not.toContain('C:\\')
      expect(rebuildLocalSessionError(error)).toBeInstanceOf(error.constructor)
    }
  })

  it('returns safe reviewed error types only', () => {
    expect(getLocalSessionErrorType(new LocalSessionValidationError('TypeError'))).toBe('TypeError')
    expect(getLocalSessionErrorType(new LocalSessionValidationError('C:\\secret\\hash'))).toBe(
      'UnknownError'
    )
    expect(getLocalSessionErrorType('password')).toBe('UnknownError')
  })
})
