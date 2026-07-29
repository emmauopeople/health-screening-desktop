import { describe, expect, it, vi } from 'vitest'

import { PasswordCredentialFormatError } from '@main/security'
import * as securityApi from '@main/security'
import * as passwordApi from '@main/security/password'
import { validateStoredPasswordCredentialForPersistence } from '@main/security/password/password-persistence-validation'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const canonicalCredential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))

describe('password persistence validation', () => {
  it('returns canonical frozen credential text and clears decoded buffers on success', () => {
    const { result, decodedBuffers } = captureDecodedBuffers(() =>
      validateStoredPasswordCredentialForPersistence(canonicalCredential)
    )

    expect(result).toEqual(canonicalCredential)
    expect(result).not.toBe(canonicalCredential)
    expect(Object.isFrozen(result)).toBe(true)
    expect(decodedBuffers.length).toBeGreaterThanOrEqual(2)
    expectZeroed(decodedBuffers)
  })

  it('clears partial decoded buffers and returns only clean format errors on failure', () => {
    const { error, decodedBuffers } = captureDecodedBuffersForError(() =>
      validateStoredPasswordCredentialForPersistence({
        passwordHash: canonicalCredential.passwordHash,
        passwordSalt: `${canonicalCredential.passwordSalt}=`
      })
    )

    expectSafeFormatError(error)
    expect(decodedBuffers.length).toBeGreaterThanOrEqual(1)
    expectZeroed(decodedBuffers)
  })

  it('rejects malformed credentials, accessors, and proxy traps without leaking details', () => {
    const accessorCredential = Object.create(null) as {
      passwordHash: unknown
      passwordSalt: unknown
    }
    Object.defineProperties(accessorCredential, {
      passwordHash: {
        enumerable: true,
        get() {
          throw new Error('C:\\secret\\hash.txt')
        }
      },
      passwordSalt: {
        enumerable: true,
        value: canonicalCredential.passwordSalt
      }
    })

    const ownKeysProxy = new Proxy(
      {
        passwordHash: canonicalCredential.passwordHash,
        passwordSalt: canonicalCredential.passwordSalt
      },
      {
        ownKeys() {
          throw new Error('C:\\secret\\ownKeys.txt')
        }
      }
    )

    const malformedCredentials: readonly unknown[] = [
      {
        passwordHash: canonicalCredential.passwordHash.replace('scrypt-v1', 'scrypt-v2'),
        passwordSalt: canonicalCredential.passwordSalt
      },
      {
        passwordHash: canonicalCredential.passwordHash,
        passwordSalt: `${canonicalCredential.passwordSalt}=`
      },
      {
        passwordHash: canonicalCredential.passwordHash,
        passwordSalt: `+${canonicalCredential.passwordSalt.slice(1)}`
      },
      {
        passwordHash: canonicalCredential.passwordHash.slice(0, -1),
        passwordSalt: canonicalCredential.passwordSalt
      },
      {
        ...canonicalCredential,
        metadata: 'C:\\secret\\metadata.json'
      },
      accessorCredential,
      ownKeysProxy
    ]

    for (const malformedCredential of malformedCredentials) {
      expectSafeFormatError(
        captureError(() => validateStoredPasswordCredentialForPersistence(malformedCredential))
      )
    }
  })

  it('is not exported from application-facing security barrels', () => {
    for (const api of [securityApi, passwordApi]) {
      expect(
        Object.prototype.hasOwnProperty.call(api, 'validateStoredPasswordCredentialForPersistence')
      ).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(api, 'passwordPersistenceValidation')).toBe(false)
    }
  })
})

function captureDecodedBuffers<T>(action: () => T): {
  readonly result: T
  readonly decodedBuffers: readonly Buffer[]
} {
  const originalFrom = Buffer.from.bind(Buffer)
  const decodedBuffers: Buffer[] = []
  const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]): Buffer => {
    const result = Reflect.apply(originalFrom, Buffer, args) as Buffer

    if (args[1] === 'base64url') {
      decodedBuffers.push(result)
    }

    return result
  }) as typeof Buffer.from)

  try {
    return {
      result: action(),
      decodedBuffers
    }
  } finally {
    fromSpy.mockRestore()
  }
}

function captureDecodedBuffersForError(action: () => void): {
  readonly error: unknown
  readonly decodedBuffers: readonly Buffer[]
} {
  const originalFrom = Buffer.from.bind(Buffer)
  const decodedBuffers: Buffer[] = []
  const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]): Buffer => {
    const result = Reflect.apply(originalFrom, Buffer, args) as Buffer

    if (args[1] === 'base64url') {
      decodedBuffers.push(result)
    }

    return result
  }) as typeof Buffer.from)

  try {
    return {
      error: captureError(action),
      decodedBuffers
    }
  } finally {
    fromSpy.mockRestore()
  }
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}

function expectZeroed(buffers: readonly Buffer[]): void {
  for (const buffer of buffers) {
    expect(Array.from(buffer)).toEqual(new Array(buffer.byteLength).fill(0))
  }
}

function expectSafeFormatError(error: unknown): void {
  expect(error).toBeInstanceOf(PasswordCredentialFormatError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    canonicalCredential.passwordHash,
    canonicalCredential.passwordSalt,
    'metadata',
    'secret',
    'C:\\',
    'ownKeys',
    'SELECT',
    'sqlite'
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
