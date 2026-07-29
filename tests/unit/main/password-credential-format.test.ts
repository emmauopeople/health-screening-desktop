import { describe, expect, it, vi } from 'vitest'

import { PasswordCredentialFormatError } from '@main/security'
import {
  createStoredPasswordCredential,
  parsePasswordHash,
  parsePasswordSalt,
  parseStoredPasswordCredential,
  serializePasswordHash,
  serializePasswordSalt
} from '@main/security/password/password-credential-format'

const canonicalSalt = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const canonicalDerivedKey =
  'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-Pw'
const canonicalHash = `scrypt-v1$N=32768$r=8$p=3$dk=64$${canonicalDerivedKey}`

describe('password credential format', () => {
  it('serializes deterministic bytes into canonical hash and salt strings', () => {
    const saltBytes = bytes(32)
    const derivedKeyBytes = bytes(64)
    const credential = createStoredPasswordCredential(derivedKeyBytes, saltBytes)

    expect(serializePasswordSalt(saltBytes)).toBe(canonicalSalt)
    expect(serializePasswordHash(derivedKeyBytes)).toBe(canonicalHash)
    expect(credential).toEqual({
      passwordHash: canonicalHash,
      passwordSalt: canonicalSalt
    })
    expect(Object.isFrozen(credential)).toBe(true)
  })

  it('strictly parses canonical credentials and decodes exact byte lengths', () => {
    const parsedHash = parsePasswordHash(canonicalHash)
    const parsedSalt = parsePasswordSalt(canonicalSalt)
    const parsedCredential = parseStoredPasswordCredential({
      passwordHash: canonicalHash,
      passwordSalt: canonicalSalt
    })

    expect(parsedHash.derivedKeyBytes).toEqual(bytes(64))
    expect(parsedSalt.saltBytes).toEqual(bytes(32))
    expect(parsedCredential.derivedKeyBytes).toEqual(bytes(64))
    expect(parsedCredential.saltBytes).toEqual(bytes(32))
    expect(Object.isFrozen(parsedCredential)).toBe(true)
  })

  it('rejects malformed password hashes without exposing credential material', () => {
    const malformedHashes = [
      canonicalHash.replace('scrypt-v1', 'scrypt-v2'),
      canonicalHash.replace('N=32768', 'N=32767'),
      canonicalHash.replace('r=8', 'r=9'),
      canonicalHash.replace('p=3', 'p=1'),
      canonicalHash.replace('dk=64', 'dk=32'),
      canonicalHash.replace('N=32768', 'N=032768'),
      canonicalHash.replace('scrypt-v1$', ''),
      `scrypt-v1$r=8$N=32768$p=3$dk=64$${canonicalDerivedKey}`,
      `scrypt-v1$N=32768$N=32768$r=8$p=3$dk=64$${canonicalDerivedKey}`,
      `scrypt-v1$N=32768$r=8$p=3$dk=64$unknown=1$${canonicalDerivedKey}`,
      ` ${canonicalHash}`,
      `${canonicalHash} `,
      `${canonicalHash}=`,
      canonicalHash.replace(canonicalDerivedKey, `${canonicalDerivedKey.slice(0, -1)}+`),
      canonicalHash.replace(canonicalDerivedKey, `${canonicalDerivedKey.slice(0, -1)}/`),
      canonicalHash.slice(0, -1),
      `${canonicalHash}trailing`
    ]

    for (const malformedHash of malformedHashes) {
      const error = captureError(() => parsePasswordHash(malformedHash))

      expectSafeFormatError(error)
    }
  })

  it('rejects malformed password salts and stored credential objects', () => {
    const malformedValues: readonly unknown[] = [
      canonicalSalt.slice(0, -1),
      `${canonicalSalt}=`,
      `${canonicalSalt.slice(0, -1)}+`,
      `${canonicalSalt.slice(0, -1)}/`,
      ` ${canonicalSalt}`,
      `${canonicalSalt} `,
      `${canonicalSalt}extra`,
      '',
      null
    ]

    for (const malformedValue of malformedValues) {
      const error = captureError(() => parsePasswordSalt(malformedValue))

      expectSafeFormatError(error)
    }

    const malformedCredentials: readonly unknown[] = [
      null,
      [],
      { passwordHash: canonicalHash },
      { passwordSalt: canonicalSalt },
      { passwordHash: canonicalHash, passwordSalt: canonicalSalt, secret: 'SecretPassw0rd!' },
      { passwordHash: canonicalHash, passwordSalt: `${canonicalSalt}=`, secret: 'SecretPassw0rd!' }
    ]

    for (const malformedCredential of malformedCredentials) {
      const error = captureError(() => parseStoredPasswordCredential(malformedCredential))

      expectSafeFormatError(error)
    }
  })

  it('rejects byte arrays with unexpected credential lengths', () => {
    expectSafeFormatError(captureError(() => serializePasswordSalt(bytes(31))))
    expectSafeFormatError(captureError(() => serializePasswordHash(bytes(63))))
    expectSafeFormatError(captureError(() => createStoredPasswordCredential(bytes(64), bytes(31))))
  })

  it('rejects a valid hash with malformed salt and cleans partial decoded buffers', () => {
    const { error, decodedBuffers } = captureBase64UrlDecodedBuffers(() =>
      parseStoredPasswordCredential({
        passwordHash: canonicalHash,
        passwordSalt: `${canonicalSalt}=`
      })
    )

    expectSafeFormatError(error)
    expect(decodedBuffers.length).toBeGreaterThanOrEqual(1)
    expect(decodedBuffers[0]!.every((byte) => byte === 0)).toBe(true)
  })

  it('rejects accessor-backed credential properties without invoking getters', () => {
    let passwordHashGetterInvoked = false
    let passwordSaltGetterInvoked = false
    const hashAccessorCredential = Object.defineProperties(
      {},
      {
        passwordHash: {
          enumerable: true,
          get() {
            passwordHashGetterInvoked = true
            throw new Error('C:\\secret\\hash-getter.log')
          }
        },
        passwordSalt: {
          enumerable: true,
          value: canonicalSalt
        }
      }
    )
    const saltAccessorCredential = Object.defineProperties(
      {},
      {
        passwordHash: {
          enumerable: true,
          value: canonicalHash
        },
        passwordSalt: {
          enumerable: true,
          get() {
            passwordSaltGetterInvoked = true
            throw new Error('C:\\secret\\salt-getter.log')
          }
        }
      }
    )

    expectSafeFormatError(captureError(() => parseStoredPasswordCredential(hashAccessorCredential)))
    expectSafeFormatError(captureError(() => parseStoredPasswordCredential(saltAccessorCredential)))
    expect(passwordHashGetterInvoked).toBe(false)
    expect(passwordSaltGetterInvoked).toBe(false)
  })

  it('converts proxy enumeration and descriptor traps to clean format errors', () => {
    const ownKeysProxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('C:\\secret\\ownKeys.log SELECT password_hash')
        }
      }
    )
    const descriptorProxy = new Proxy(
      {
        passwordHash: canonicalHash,
        passwordSalt: canonicalSalt
      },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.log password_salt')
        }
      }
    )

    expectSafeFormatError(captureError(() => parseStoredPasswordCredential(ownKeysProxy)))
    expectSafeFormatError(captureError(() => parseStoredPasswordCredential(descriptorProxy)))
  })
})

function bytes(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => index))
}

function expectSafeFormatError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).toBeInstanceOf(PasswordCredentialFormatError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    canonicalSalt,
    canonicalDerivedKey,
    canonicalHash,
    'SecretPassw0rd',
    'scrypt-v1$',
    '32768',
    'AAECA',
    'ownKeys',
    'descriptor',
    'getter',
    'password_hash',
    'password_salt',
    'C:\\',
    'SELECT'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function captureBase64UrlDecodedBuffers(action: () => void): {
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

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
