import { describe, expect, it } from 'vitest'

import {
  decodeFailedLoginCount,
  decodeSqliteBoolean,
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  RepositoryValidationError
} from '@main/database'

describe('local user validation', () => {
  it('canonicalizes reviewed ASCII usernames and normalized keys', () => {
    expect(parseUsernameIdentity('Admin.User')).toEqual({
      username: 'Admin.User',
      usernameNormalized: 'admin.user'
    })
    expect(parseUsernameIdentity('  screener-01  ')).toEqual({
      username: 'screener-01',
      usernameNormalized: 'screener-01'
    })
    expect(parseUsernameIdentity('Ａdmin')).toEqual({
      username: 'Admin',
      usernameNormalized: 'admin'
    })
    expect(parseUsernameIdentity('abc')).toEqual({
      username: 'abc',
      usernameNormalized: 'abc'
    })

    const maximumUsername = `A${'b'.repeat(62)}9`
    expect(parseUsernameIdentity(maximumUsername)).toEqual({
      username: maximumUsername,
      usernameNormalized: maximumUsername.toLowerCase()
    })
  })

  it('rejects unsafe username input with clean validation errors', () => {
    for (const value of [
      'ab',
      `A${'b'.repeat(64)}`,
      'admin user',
      'admin@example.com',
      '/admin',
      'admin/admin',
      'admin\\admin',
      'admin:root',
      '.admin',
      'admin.',
      'admin\nroot',
      'admin\u0000root',
      '\ud800admin',
      12,
      null
    ]) {
      expectSafeValidationError(captureError(() => parseUsernameIdentity(value)))
    }
  })

  it('canonicalizes printable display names independently from login identity', () => {
    expect(parseUserDisplayName('  Dr.\u00a0Élodie   Ngono  ')).toBe('Dr. Élodie Ngono')
    expect(parseUserDisplayName('Ｍbimu Emmanuel')).toBe('Mbimu Emmanuel')
    expect(parseUserDisplayName('A')).toBe('A')

    const maximumDisplayName = 'A'.repeat(120)
    expect(parseUserDisplayName(maximumDisplayName)).toBe(maximumDisplayName)
  })

  it('rejects unsafe display names with clean validation errors', () => {
    for (const value of [
      '',
      '   ',
      'A'.repeat(121),
      'Nurse\u0000Name',
      'Nurse\tName',
      'Line\u2028Break',
      'Paragraph\u2029Break',
      '\udc00Name',
      12,
      null
    ]) {
      expectSafeValidationError(captureError(() => parseUserDisplayName(value)))
    }
  })

  it('strictly validates roles, SQLite booleans, and counters', () => {
    expect(parseLocalUserRole('LOCAL_ADMIN')).toBe('LOCAL_ADMIN')
    expect(parseLocalUserRole('NURSE')).toBe('NURSE')
    expect(parseLocalUserRole('TRAINED_SCREENER')).toBe('TRAINED_SCREENER')
    expect(decodeSqliteBoolean(0)).toBe(false)
    expect(decodeSqliteBoolean(1)).toBe(true)
    expect(decodeFailedLoginCount(0)).toBe(0)
    expect(decodeFailedLoginCount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)

    for (const value of ['local_admin', 'ADMIN', 1, null, [], {}]) {
      expectSafeValidationError(captureError(() => parseLocalUserRole(value)))
    }

    for (const value of [true, false, '1', null, 2, -1, 1.5]) {
      expectSafeValidationError(captureError(() => decodeSqliteBoolean(value)))
    }

    for (const value of [true, '0', null, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expectSafeValidationError(captureError(() => decodeFailedLoginCount(value)))
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    'admin@example.com',
    'admin user',
    'Nurse',
    'Élodie',
    'SELECT',
    'C:\\',
    'password',
    'salt',
    'hash'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
