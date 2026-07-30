import { describe, expect, it } from 'vitest'

import { LocalLoginValidationError, parseLocalLoginInput } from '@main/application/authentication'

const validPassword = 'ValidPassw0rd!'

describe('local login validation', () => {
  it('accepts exact Object.prototype and null-prototype commands', () => {
    const ordinary = Object.freeze({
      username: ' \uff21dmin.User ',
      password: validPassword
    })
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.username = 'ADMIN.USER'
    nullPrototype.password = validPassword

    expect(parseLocalLoginInput(ordinary)).toEqual({
      username: 'Admin.User',
      password: validPassword
    })
    expect(parseLocalLoginInput(nullPrototype)).toEqual({
      username: 'ADMIN.USER',
      password: validPassword
    })
    expect(Object.isFrozen(parseLocalLoginInput(ordinary))).toBe(true)
  })

  it('rejects missing, extra, inherited, symbol, accessor, array, function, and class inputs', () => {
    class Command {
      readonly username = 'Admin.User'
      readonly password = validPassword
    }

    const inherited = Object.create({
      username: 'Admin.User',
      password: validPassword
    })
    const symbolCommand = {
      username: 'Admin.User',
      password: validPassword,
      [Symbol('secret')]: true
    }
    const accessorCommand = { username: 'Admin.User' } as Record<string, unknown>
    let getterInvoked = false
    Object.defineProperty(accessorCommand, 'password', {
      enumerable: true,
      get() {
        getterInvoked = true
        throw new Error('C:\\secret\\password-getter.txt')
      }
    })

    for (const value of [
      null,
      [],
      () => undefined,
      {},
      { username: 'Admin.User' },
      { password: validPassword },
      { username: 'Admin.User', password: validPassword, extra: true },
      inherited,
      symbolCommand,
      accessorCommand,
      new Command()
    ]) {
      expectSafeValidationError(captureError(() => parseLocalLoginInput(value)))
    }

    expect(getterInvoked).toBe(false)
  })

  it('rejects malformed usernames and passwords through the login boundary', () => {
    for (const value of [
      { username: 'ab', password: validPassword },
      { username: 'Admin User', password: validPassword },
      { username: 'Admin.User', password: 'short' },
      { username: 'Admin.User', password: 'bad\u0000password-value' }
    ]) {
      expectSafeValidationError(captureError(() => parseLocalLoginInput(value)))
    }
  })

  it('maps hostile proxy failures to controlled validation errors', () => {
    const ownKeysProxy = new Proxy(
      { username: 'Admin.User', password: validPassword },
      {
        ownKeys() {
          throw new Error('C:\\secret\\login-ownKeys.txt')
        }
      }
    )
    const descriptorProxy = new Proxy(
      { username: 'Admin.User', password: validPassword },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\login-descriptor.txt')
        }
      }
    )
    const prototypeProxy = new Proxy(
      { username: 'Admin.User', password: validPassword },
      {
        getPrototypeOf() {
          throw new Error('C:\\secret\\login-prototype.txt')
        }
      }
    )

    for (const value of [ownKeysProxy, descriptorProxy, prototypeProxy]) {
      expectSafeValidationError(captureError(() => parseLocalLoginInput(value)))
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(LocalLoginValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of [
    validPassword,
    'Admin',
    'password-value',
    'secret',
    'C:\\',
    'ownKeys',
    'descriptor',
    'prototype',
    'SELECT'
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
