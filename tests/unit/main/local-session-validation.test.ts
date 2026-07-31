import { describe, expect, it } from 'vitest'

import {
  LocalSessionStateIntegrityError,
  LocalSessionValidationError,
  parseCredentialFreeLocalSessionUser,
  parseLocalSessionPasswordChangeInput,
  parseLocalSessionRoleList,
  parseLocalSessionUnlockInput
} from '@main/application'
import {
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  type LocalUserRecord
} from '@main/database'
import { parseEntityId, parseUtcTimestamp } from '@main/foundation'

const currentPassword = 'CurrentPassw0rd!'
const newPassword = 'ReplacementPassw0rd!'

describe('local session validation', () => {
  it('accepts exact Object.prototype and null-prototype password commands', () => {
    const passwordChange = {
      currentPassword,
      newPassword,
      confirmNewPassword: newPassword
    }
    const nullPrototypePasswordChange = Object.assign(Object.create(null), passwordChange)
    const unlock = { password: currentPassword }
    const nullPrototypeUnlock = Object.assign(Object.create(null), unlock)

    expect(parseLocalSessionPasswordChangeInput(passwordChange)).toEqual(passwordChange)
    expect(parseLocalSessionPasswordChangeInput(nullPrototypePasswordChange)).toEqual(
      passwordChange
    )
    expect(parseLocalSessionUnlockInput(unlock)).toEqual(unlock)
    expect(parseLocalSessionUnlockInput(nullPrototypeUnlock)).toEqual(unlock)
  })

  it('rejects hostile command shapes without invoking getters', () => {
    let getterTouched = false
    const accessorInput = {
      currentPassword,
      newPassword,
      confirmNewPassword: newPassword
    }
    Object.defineProperty(accessorInput, 'newPassword', {
      enumerable: true,
      get() {
        getterTouched = true
        throw new Error('C:\\secret\\password.txt')
      }
    })

    const inheritedOnly = Object.create({
      currentPassword,
      newPassword,
      confirmNewPassword: newPassword
    }) as unknown
    const proxyInput = new Proxy(
      {
        currentPassword,
        newPassword,
        confirmNewPassword: newPassword
      },
      {
        ownKeys() {
          throw new Error('C:\\secret\\ownKeys.txt')
        }
      }
    )

    for (const value of [
      null,
      [],
      () => undefined,
      { currentPassword, newPassword },
      { currentPassword, newPassword, confirmNewPassword: newPassword, userId: 'attacker' },
      { currentPassword, newPassword, confirmNewPassword: newPassword, [Symbol('secret')]: true },
      inheritedOnly,
      accessorInput,
      proxyInput
    ]) {
      expectSafeValidationError(captureError(() => parseLocalSessionPasswordChangeInput(value)))
    }

    expect(getterTouched).toBe(false)
  })

  it('validates exact non-empty unique role arrays without invoking accessors', () => {
    expect(parseLocalSessionRoleList(['LOCAL_ADMIN', 'NURSE'])).toEqual(['LOCAL_ADMIN', 'NURSE'])
    expect(Object.isFrozen(parseLocalSessionRoleList(['TRAINED_SCREENER']))).toBe(true)

    let getterTouched = false
    const accessorRoles = ['LOCAL_ADMIN']
    Object.defineProperty(accessorRoles, '0', {
      enumerable: true,
      get() {
        getterTouched = true
        throw new Error('C:\\secret\\role.txt')
      }
    })

    for (const value of [
      [],
      ['LOCAL_ADMIN', 'LOCAL_ADMIN'],
      ['LOCAL_ADMIN', 'UNKNOWN_ROLE'],
      Object.assign(['LOCAL_ADMIN'], { extra: true }),
      accessorRoles,
      new Proxy(['LOCAL_ADMIN'], {
        ownKeys() {
          throw new Error('C:\\secret\\roles.txt')
        }
      })
    ]) {
      expectSafeValidationError(captureError(() => parseLocalSessionRoleList(value)))
    }

    expect(getterTouched).toBe(false)
  })

  it('returns frozen canonical credential-free user records', () => {
    const user = createUser()
    const parsed = parseCredentialFreeLocalSessionUser(user)

    expect(parsed).toEqual(user)
    expect(parsed).not.toBe(user)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  it('rejects malformed or credential-bearing dependency users without leaking data', () => {
    for (const value of [
      { ...createUser(), passwordHash: 'secret-hash' },
      { ...createUser(), credential: { passwordHash: 'secret-hash', passwordSalt: 'secret-salt' } },
      { ...createUser(), username: ' Admin.User ' },
      { ...createUser(), isActive: 1 },
      { ...createUser(), extra: true }
    ]) {
      const error = captureError(() => parseCredentialFreeLocalSessionUser(value))

      expect(error).toBeInstanceOf(LocalSessionStateIntegrityError)
      expect(JSON.stringify(error)).not.toContain('secret-hash')
      expect(JSON.stringify(error)).not.toContain('secret-salt')
      expect((error as Error).stack).toBeUndefined()
    }
  })
})

function createUser(): LocalUserRecord {
  return Object.freeze({
    id: parseEntityId('11111111-1111-4111-8111-111111111111'),
    username: parseUsernameIdentity('Admin.User').username,
    displayName: parseUserDisplayName('Admin User'),
    role: parseLocalUserRole('LOCAL_ADMIN'),
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: parseUtcTimestamp('2026-07-30T12:00:00.000Z'),
    createdAt: parseUtcTimestamp('2026-07-30T09:00:00.000Z'),
    updatedAt: parseUtcTimestamp('2026-07-30T12:00:00.000Z')
  })
}

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(LocalSessionValidationError)
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of ['CurrentPassw0rd!', 'ReplacementPassw0rd!', 'secret', 'C:\\']) {
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
