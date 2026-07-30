import { describe, expect, it } from 'vitest'

import {
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError,
  type FirstRunError
} from '@main/application'
import { isFirstRunError, rebuildFirstRunError } from '@main/application/first-run/first-run-errors'

describe('first-run errors', () => {
  it('uses fixed safe codes, messages, and serialization shape', () => {
    const errors: readonly FirstRunError[] = [
      new FirstRunValidationError('RepositoryValidationError'),
      new FirstRunAlreadyInitializedError('FirstRunAlreadyInitializedError'),
      new FirstRunStateIntegrityError('FirstRunStateIntegrityError'),
      new FirstRunInitializationInProgressError('FirstRunInitializationInProgressError'),
      new FirstRunInitializationError('PasswordHashingError')
    ]

    expect(errors.map((error) => error.code)).toEqual([
      'FIRST_RUN_VALIDATION_ERROR',
      'FIRST_RUN_ALREADY_INITIALIZED',
      'FIRST_RUN_STATE_INTEGRITY_ERROR',
      'FIRST_RUN_INITIALIZATION_IN_PROGRESS',
      'FIRST_RUN_INITIALIZATION_ERROR'
    ])
    expect(errors.map((error) => error.message)).toEqual([
      'First-run setup input is invalid.',
      'Application setup is already complete.',
      'Application setup state is inconsistent.',
      'Application setup is already in progress.',
      'Application setup could not be completed.'
    ])

    for (const error of errors) {
      expect(isFirstRunError(error)).toBe(true)
      expectSafeFirstRunError(error)
    }
  })

  it('sanitizes arbitrary error types and rebuilds clean instances', () => {
    const incoming = new FirstRunInitializationError(
      'passwordHash'
    ) as FirstRunInitializationError & {
      cause: Error
      command: string
      metadata: string
      password: string
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\bootstrap.sqlite3')
    incoming.command = 'Cameroon Pilot Admin.User Central Church'
    incoming.metadata = '{"bootstrap":true}'
    incoming.password = 'ValidPassw0rd!'
    incoming.stack = 'SELECT * FROM users'

    const rebuilt = rebuildFirstRunError(incoming)

    expect(rebuilt).toBeInstanceOf(FirstRunInitializationError)
    expect(rebuilt).not.toBe(incoming)
    expect(rebuilt.errorType).toBe('UnknownError')
    expectSafeFirstRunError(rebuilt)
  })

  it('does not trust raw errors renamed as first-run errors', () => {
    const rawError = new Error('C:\\secret\\setup.txt')
    rawError.name = 'FirstRunValidationError'

    expect(isFirstRunError(rawError)).toBe(false)
  })
})

function expectSafeFirstRunError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    'ValidPassw0rd',
    'passwordHash',
    'Cameroon',
    'Admin.User',
    'Central',
    'bootstrap.sqlite3',
    'SELECT',
    'users',
    'secret',
    'metadata'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}
