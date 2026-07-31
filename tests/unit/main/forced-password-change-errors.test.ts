import { describe, expect, it } from 'vitest'

import {
  getLocalForcedPasswordChangeErrorType,
  isLocalForcedPasswordChangeError,
  LocalForcedPasswordChangeCompositionError,
  LocalForcedPasswordChangeConcurrencyError,
  LocalForcedPasswordChangeHashingError,
  LocalForcedPasswordChangePersistenceError,
  LocalForcedPasswordChangeStateIntegrityError,
  LocalForcedPasswordChangeUnavailableError,
  LocalForcedPasswordChangeValidationError,
  LocalForcedPasswordChangeVerificationError,
  rebuildLocalForcedPasswordChangeError,
  type LocalForcedPasswordChangeError
} from '@main/application'

describe('forced password change errors', () => {
  it('uses fixed safe codes, messages, and serialization shape', () => {
    const errors: readonly LocalForcedPasswordChangeError[] = [
      new LocalForcedPasswordChangeValidationError('PasswordValidationError'),
      new LocalForcedPasswordChangeUnavailableError('RepositoryReadError'),
      new LocalForcedPasswordChangeStateIntegrityError('RepositoryDataIntegrityError'),
      new LocalForcedPasswordChangeConcurrencyError('LocalUserCredentialStateConflictError'),
      new LocalForcedPasswordChangeVerificationError('PasswordVerificationError'),
      new LocalForcedPasswordChangeHashingError('PasswordHashingError'),
      new LocalForcedPasswordChangePersistenceError('RepositoryWriteError'),
      new LocalForcedPasswordChangeCompositionError('TypeError')
    ]

    expect(errors.map((error) => error.code)).toEqual([
      'LOCAL_FORCED_PASSWORD_CHANGE_VALIDATION_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_UNAVAILABLE',
      'LOCAL_FORCED_PASSWORD_CHANGE_STATE_INTEGRITY_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_CONCURRENCY_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_VERIFICATION_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_HASHING_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_PERSISTENCE_ERROR',
      'LOCAL_FORCED_PASSWORD_CHANGE_COMPOSITION_ERROR'
    ])
    expect(errors.map((error) => error.message)).toEqual([
      'Forced password change command is invalid.',
      'Forced password change is unavailable.',
      'Forced password change state is inconsistent.',
      'Forced password change state changed before completion.',
      'Forced password change credential could not be verified.',
      'Forced password change credential could not be created.',
      'Forced password change outcome could not be persisted.',
      'Forced password change service could not be composed.'
    ])

    for (const error of errors) {
      expect(isLocalForcedPasswordChangeError(error)).toBe(true)
      expect(error).not.toHaveProperty('cause')
      expect(error.stack).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain('stack')
      expect(JSON.stringify(error)).not.toContain('secret')
      expect(JSON.stringify(error)).not.toContain('SELECT')
      expect(getLocalForcedPasswordChangeErrorType(error)).toBe(error.errorType)
    }
  })

  it('sanitizes arbitrary error types and rebuilds clean instances', () => {
    const incoming = new LocalForcedPasswordChangePersistenceError(
      'passwordHash'
    ) as LocalForcedPasswordChangePersistenceError & {
      cause: Error
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\health-screening.sqlite3')
    incoming.stack = 'SELECT password_hash FROM users'

    const rebuilt = rebuildLocalForcedPasswordChangeError(incoming)

    expect(rebuilt).toBeInstanceOf(LocalForcedPasswordChangePersistenceError)
    expect(rebuilt).not.toBe(incoming)
    expect(rebuilt.errorType).toBe('UnknownError')
    expect(rebuilt).not.toHaveProperty('cause')
    expect(rebuilt.stack).toBeUndefined()
    expect(JSON.stringify(rebuilt)).not.toContain('passwordHash')
    expect(JSON.stringify(rebuilt)).not.toContain('SELECT')
  })

  it('does not trust raw errors renamed as forced password change errors', () => {
    const rawError = new Error('C:\\secret\\health-screening.sqlite3')
    rawError.name = 'LocalForcedPasswordChangePersistenceError'

    expect(isLocalForcedPasswordChangeError(rawError)).toBe(false)
  })
})
