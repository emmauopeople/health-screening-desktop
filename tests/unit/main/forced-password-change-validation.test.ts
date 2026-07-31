import { describe, expect, it } from 'vitest'

import {
  LocalForcedPasswordChangeValidationError,
  parseLocalForcedPasswordChangeInput
} from '@main/application'

const userId = '11111111-1111-4111-8111-111111111111'
const currentPassword = 'CurrentPassw0rd!'
const newPassword = 'ReplacementPassw0rd!'

describe('forced password change validation', () => {
  it('accepts exact Object.prototype and null-prototype commands', () => {
    const parsed = parseLocalForcedPasswordChangeInput(createValidCommand())
    const nullPrototypeCommand = Object.assign(Object.create(null), createValidCommand())

    expect(parsed).toEqual({
      userId,
      currentPassword,
      newPassword,
      confirmNewPassword: newPassword
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(parseLocalForcedPasswordChangeInput(nullPrototypeCommand)).toEqual(parsed)
  })

  it('rejects hostile object shapes without invoking getters', () => {
    const inheritedOnly = Object.create(createValidCommand()) as unknown
    const customPrototype = createValidCommand()
    Object.setPrototypeOf(customPrototype, { custom: true })

    let getterTouched = false
    const accessorInput = createValidCommand()
    Object.defineProperty(accessorInput, 'userId', {
      enumerable: true,
      get() {
        getterTouched = true
        throw new Error('C:\\secret\\getter.txt')
      }
    })

    const symbolInput = {
      ...createValidCommand(),
      [Symbol('secret')]: true
    }
    const proxyInput = new Proxy(createValidCommand(), {
      ownKeys() {
        throw new Error('C:\\secret\\ownKeys.txt')
      }
    })

    for (const value of [
      null,
      [],
      () => createValidCommand(),
      new Date(),
      new Map(),
      { ...createValidCommand(), extra: true },
      { userId, currentPassword, newPassword },
      inheritedOnly,
      customPrototype,
      accessorInput,
      symbolInput,
      proxyInput
    ]) {
      expectSafeValidationError(captureError(() => parseLocalForcedPasswordChangeInput(value)))
    }

    expect(getterTouched).toBe(false)
  })

  it('rejects invalid user IDs and passwords safely', () => {
    for (const override of [
      { userId: '11111111-1111-1111-8111-111111111111' },
      { currentPassword: 'short' },
      { currentPassword: 'Invalid\u0000Password!' },
      { newPassword: 'short' },
      { confirmNewPassword: 'short' }
    ]) {
      expectSafeValidationError(
        captureError(() =>
          parseLocalForcedPasswordChangeInput({
            ...createValidCommand(),
            ...override
          })
        )
      )
    }
  })
})

function createValidCommand(): Record<string, unknown> {
  return {
    userId,
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword
  }
}

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(LocalForcedPasswordChangeValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    userId,
    currentPassword,
    newPassword,
    'secret',
    'C:\\',
    'SELECT',
    'hash',
    'salt'
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
