import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { LocalUserCredentialStateConflictError, RepositoryValidationError } from '@main/database'
import { parseUpdateLocalUserCredentialStateInput } from '@main/database/repositories/local-user/local-user-validation'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const userId = '11111111-1111-4111-8111-111111111111'
const expectedUpdatedAt = '2026-07-29T12:10:00.000Z'
const rotatedAt = '2026-07-29T12:15:00.000Z'
const currentCredential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))
const nextCredential = createStoredPasswordCredential(fixedBytes(64, 3), fixedBytes(32, 4))

describe('local user credential-state validation', () => {
  it('accepts exact mutation input and returns frozen canonical snapshots', () => {
    const parsed = parseUpdateLocalUserCredentialStateInput(createValidMutationInput())

    expect(parsed).toEqual({
      id: userId,
      expected: {
        credential: currentCredential,
        mustChangePassword: true,
        updatedAt: expectedUpdatedAt
      },
      next: {
        credential: nextCredential,
        mustChangePassword: false,
        updatedAt: rotatedAt
      }
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.expected)).toBe(true)
    expect(Object.isFrozen(parsed.next)).toBe(true)
    expect(Object.isFrozen(parsed.expected.credential)).toBe(true)
    expect(Object.isFrozen(parsed.next.credential)).toBe(true)
  })

  it('rejects hostile top-level and nested snapshot objects safely', () => {
    const inheritedOnly = Object.create(createValidMutationInput()) as unknown
    const customPrototype = createValidMutationInput()
    Object.setPrototypeOf(customPrototype, { custom: true })

    const nullPrototype = Object.assign(Object.create(null), createValidMutationInput())

    let getterTouched = false
    const accessorInput = createValidMutationInput()
    Object.defineProperty(accessorInput, 'id', {
      enumerable: true,
      get() {
        getterTouched = true
        throw new Error('C:\\secret\\id-getter.txt')
      }
    })

    const symbolInput = {
      ...createValidMutationInput(),
      [Symbol('secret')]: true
    }

    const proxyInput = new Proxy(createValidMutationInput(), {
      ownKeys() {
        throw new Error('C:\\secret\\ownKeys.txt')
      }
    })

    for (const value of [
      null,
      [],
      new Date(rotatedAt),
      new Map(),
      new Set(),
      { ...createValidMutationInput(), extra: 'not allowed' },
      symbolInput,
      inheritedOnly,
      customPrototype,
      nullPrototype,
      accessorInput,
      proxyInput,
      {
        ...createValidMutationInput(),
        expected: { ...createValidSnapshot(), extra: true }
      },
      {
        ...createValidMutationInput(),
        next: Object.assign(Object.create(null), createValidNextSnapshot())
      }
    ]) {
      expectSafeValidationError(captureError(() => parseUpdateLocalUserCredentialStateInput(value)))
    }

    expect(getterTouched).toBe(false)
  })

  it('rejects invalid IDs, credentials, booleans, timestamps, and backward versions', () => {
    const invalidInputs = [
      { id: '11111111-1111-1111-8111-111111111111' },
      { expected: { ...createValidSnapshot(), credential: null } },
      { expected: { ...createValidSnapshot(), credential: [] } },
      {
        expected: {
          ...createValidSnapshot(),
          credential: {
            passwordHash: currentCredential.passwordHash,
            passwordSalt: `${currentCredential.passwordSalt}=`
          }
        }
      },
      { expected: { ...createValidSnapshot(), mustChangePassword: 1 } },
      { next: { ...createValidNextSnapshot(), mustChangePassword: 'false' } },
      { expected: { ...createValidSnapshot(), updatedAt: 'not-a-timestamp' } },
      { next: { ...createValidNextSnapshot(), updatedAt: '2026-07-29T12:09:59.999Z' } }
    ] as const

    for (const override of invalidInputs) {
      expectSafeValidationError(
        captureError(() =>
          parseUpdateLocalUserCredentialStateInput({
            ...createValidMutationInput(),
            ...override
          })
        )
      )
    }
  })

  it('exposes only reviewed credential-state surface through public barrels', () => {
    expect(typeof parseUpdateLocalUserCredentialStateInput).toBe('function')
    expect(new LocalUserCredentialStateConflictError()).toMatchObject({
      code: 'LOCAL_USER_CREDENTIAL_STATE_CONFLICT'
    })

    const localUserBarrel = readFileSync(
      join(process.cwd(), 'src/main/database/repositories/local-user/index.ts'),
      'utf8'
    )
    const repositoryBarrel = readFileSync(
      join(process.cwd(), 'src/main/database/repositories/index.ts'),
      'utf8'
    )
    const databaseBarrel = readFileSync(join(process.cwd(), 'src/main/database/index.ts'), 'utf8')

    for (const source of [localUserBarrel, repositoryBarrel, databaseBarrel]) {
      expect(source).not.toContain('parseUpdateLocalUserCredentialStateInput')
      expect(source).not.toContain('updateLocalUserCredentialStateSql')
      expect(source).not.toContain('validateStoredPasswordCredentialForPersistence')
      expect(source).not.toContain('password_hash')
      expect(source).not.toContain('password_salt')
    }
  })
})

function createValidMutationInput(): Record<string, unknown> {
  return {
    id: userId,
    expected: createValidSnapshot(),
    next: createValidNextSnapshot()
  }
}

function createValidSnapshot(): Record<string, unknown> {
  return {
    credential: currentCredential,
    mustChangePassword: true,
    updatedAt: expectedUpdatedAt
  }
}

function createValidNextSnapshot(): Record<string, unknown> {
  return {
    credential: nextCredential,
    mustChangePassword: false,
    updatedAt: rotatedAt
  }
}

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    userId,
    expectedUpdatedAt,
    rotatedAt,
    '12:09:59',
    'secret',
    'C:\\',
    'SELECT',
    'users',
    currentCredential.passwordHash,
    currentCredential.passwordSalt,
    nextCredential.passwordHash,
    nextCredential.passwordSalt
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
