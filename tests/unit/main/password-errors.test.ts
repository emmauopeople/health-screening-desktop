import { describe, expect, it } from 'vitest'

import {
  isPasswordCredentialError,
  PasswordCredentialFormatError,
  PasswordHashingError,
  PasswordValidationError,
  PasswordVerificationError,
  rebuildPasswordCredentialError,
  type PasswordCredentialError
} from '@main/security'

describe('password credential errors', () => {
  it('uses fixed safe codes, messages, and serialization shape', () => {
    const errors: readonly PasswordCredentialError[] = [
      new PasswordValidationError('TypeError'),
      new PasswordCredentialFormatError('PasswordCredentialFormatError'),
      new PasswordHashingError('PasswordHashingError'),
      new PasswordVerificationError('PasswordVerificationError')
    ]

    expect(errors.map((error) => error.code)).toEqual([
      'PASSWORD_VALIDATION_ERROR',
      'PASSWORD_CREDENTIAL_FORMAT_ERROR',
      'PASSWORD_HASHING_ERROR',
      'PASSWORD_VERIFICATION_ERROR'
    ])
    expect(errors.map((error) => error.message)).toEqual([
      'Password input failed validation.',
      'Password credential format is not supported.',
      'Password credential could not be created.',
      'Password credential could not be verified.'
    ])

    for (const error of errors) {
      expect(isPasswordCredentialError(error)).toBe(true)
      expectSafePasswordError(error)
    }
  })

  it('sanitizes arbitrary error types and rebuilds clean instances', () => {
    const incoming = new PasswordHashingError('passwordHash') as PasswordHashingError & {
      cause: Error
      password: string
      passwordHash: string
      passwordSalt: string
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\credential.sqlite3')
    incoming.password = 'SecretPassw0rd!'
    incoming.passwordHash = 'scrypt-v1$N=32768$r=8$p=3$dk=64$secret'
    incoming.passwordSalt = 'salt-secret'
    incoming.stack = 'raw crypto stack'

    const rebuilt = rebuildPasswordCredentialError(incoming)

    expect(rebuilt).toBeInstanceOf(PasswordHashingError)
    expect(rebuilt).not.toBe(incoming)
    expect(rebuilt.errorType).toBe('UnknownError')
    expectSafePasswordError(rebuilt)
  })

  it('does not trust raw errors renamed as password errors', () => {
    const rawError = new Error('C:\\secret\\passwords.txt')
    rawError.name = 'PasswordValidationError'

    expect(isPasswordCredentialError(rawError)).toBe(false)
  })
})

function expectSafePasswordError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    'SecretPassw0rd',
    'passwordHash',
    'passwordSalt',
    'scrypt-v1',
    'salt-secret',
    'credential.sqlite3',
    'raw crypto',
    'secret'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}
