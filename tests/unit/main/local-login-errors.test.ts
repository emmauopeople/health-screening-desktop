import { describe, expect, it } from 'vitest'

import {
  isLocalLoginError,
  LocalLoginCompositionError,
  LocalLoginConcurrencyError,
  LocalLoginPersistenceError,
  LocalLoginStateIntegrityError,
  LocalLoginUnavailableError,
  LocalLoginValidationError,
  LocalLoginVerificationError,
  rebuildLocalLoginError,
  type LocalLoginError
} from '@main/application/authentication'

describe('local login errors', () => {
  it('uses fixed codes, messages, sanitized types, and no stacks', () => {
    const errors: readonly LocalLoginError[] = [
      new LocalLoginValidationError('PasswordValidationError'),
      new LocalLoginUnavailableError('RepositoryReadError'),
      new LocalLoginStateIntegrityError('RepositoryDataIntegrityError'),
      new LocalLoginConcurrencyError('LocalLoginConcurrencyError'),
      new LocalLoginVerificationError('PasswordVerificationError'),
      new LocalLoginPersistenceError('RepositoryWriteError'),
      new LocalLoginCompositionError('PasswordHashingError')
    ]

    expect(errors.map((error) => error.code)).toEqual([
      'LOCAL_LOGIN_VALIDATION_ERROR',
      'LOCAL_LOGIN_UNAVAILABLE',
      'LOCAL_LOGIN_STATE_INTEGRITY_ERROR',
      'LOCAL_LOGIN_CONCURRENCY_ERROR',
      'LOCAL_LOGIN_VERIFICATION_ERROR',
      'LOCAL_LOGIN_PERSISTENCE_ERROR',
      'LOCAL_LOGIN_COMPOSITION_ERROR'
    ])
    expect(errors.map((error) => error.message)).toEqual([
      'Local login command is invalid.',
      'Local login is unavailable.',
      'Local login state is inconsistent.',
      'Local login state changed before completion.',
      'Local login credential could not be verified.',
      'Local login outcome could not be persisted.',
      'Local login service could not be composed.'
    ])

    for (const error of errors) {
      expect(isLocalLoginError(error)).toBe(true)
      expectSafeLocalLoginError(error)
    }
  })

  it('rebuilds safe instances and sanitizes hostile error types', () => {
    const incoming = new LocalLoginPersistenceError(
      'passwordHash'
    ) as LocalLoginPersistenceError & {
      cause: Error
      command: string
      password: string
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\login.sqlite3')
    incoming.command = 'Admin.User'
    incoming.password = 'ValidPassw0rd!'
    incoming.stack = 'SELECT password_hash FROM users'

    const rebuilt = rebuildLocalLoginError(incoming)

    expect(rebuilt).toBeInstanceOf(LocalLoginPersistenceError)
    expect(rebuilt).not.toBe(incoming)
    expect(rebuilt.errorType).toBe('UnknownError')
    expectSafeLocalLoginError(rebuilt)
  })

  it('does not trust raw errors renamed as local login errors', () => {
    const rawError = new Error('C:\\secret\\login.txt')
    rawError.name = 'LocalLoginValidationError'

    expect(isLocalLoginError(rawError)).toBe(false)
  })
})

function expectSafeLocalLoginError(error: unknown): void {
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of [
    'ValidPassw0rd',
    'passwordHash',
    'Admin.User',
    'login.sqlite3',
    'SELECT',
    'users',
    'secret',
    'command'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}
