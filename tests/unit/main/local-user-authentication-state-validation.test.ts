import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  parseUpdateLocalUserAuthenticationStateInput,
  RepositoryValidationError
} from '@main/database'

const userId = '11111111-1111-4111-8111-111111111111'
const previousLoginAt = '2026-07-29T12:00:00.000Z'
const expectedUpdatedAt = '2026-07-29T12:10:00.000Z'
const attemptAt = '2026-07-29T12:15:00.000Z'
const futureLockUntil = '2026-07-29T12:30:00.000Z'

describe('local user authentication-state validation', () => {
  it('accepts strict mutation input without rewriting canonical values', () => {
    expect(parseUpdateLocalUserAuthenticationStateInput(createValidMutationInput())).toEqual({
      id: userId,
      expected: {
        failedLoginCount: 2,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt: expectedUpdatedAt
      },
      next: {
        failedLoginCount: 3,
        lockedUntil: futureLockUntil,
        lastLoginAt: previousLoginAt,
        updatedAt: attemptAt
      }
    })
  })

  it('rejects hostile top-level and nested objects safely', () => {
    const inheritedOnly = Object.create(createValidMutationInput()) as unknown
    const customPrototype = createValidMutationInput()
    Object.setPrototypeOf(customPrototype, { custom: true })

    const accessorInput = createValidMutationInput()
    Object.defineProperty(accessorInput, 'id', {
      enumerable: true,
      get() {
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
      new Date(attemptAt),
      new Map(),
      new Set(),
      { ...createValidMutationInput(), extra: 'not allowed' },
      symbolInput,
      inheritedOnly,
      customPrototype,
      accessorInput,
      proxyInput,
      {
        ...createValidMutationInput(),
        expected: { ...createValidSnapshot(), extra: true }
      },
      {
        ...createValidMutationInput(),
        next: Object.create(createValidSnapshot()) as unknown
      }
    ]) {
      expectSafeValidationError(
        captureError(() => parseUpdateLocalUserAuthenticationStateInput(value))
      )
    }
  })

  it('rejects invalid IDs, timestamps, counts, and temporal transitions', () => {
    const invalidInputs = [
      { id: '11111111-1111-1111-8111-111111111111' },
      { expected: { ...createValidSnapshot(), failedLoginCount: -1 } },
      { expected: { ...createValidSnapshot(), failedLoginCount: 1.25 } },
      { expected: { ...createValidSnapshot(), failedLoginCount: Number.NaN } },
      { expected: { ...createValidSnapshot(), failedLoginCount: Number.POSITIVE_INFINITY } },
      { expected: { ...createValidSnapshot(), failedLoginCount: Number.MAX_SAFE_INTEGER + 1 } },
      { expected: { ...createValidSnapshot(), lockedUntil: 'not-a-timestamp' } },
      { expected: { ...createValidSnapshot(), lastLoginAt: '2026-07-29T12:00:00Z' } },
      { next: { ...createValidNextSnapshot(), updatedAt: '2026-07-29T12:09:59.999Z' } },
      { next: { ...createValidNextSnapshot(), lastLoginAt: '2026-07-29T11:59:59.999Z' } },
      { next: { ...createValidNextSnapshot(), lastLoginAt: null } },
      { next: { ...createValidNextSnapshot(), lockedUntil: attemptAt } },
      { next: { ...createValidNextSnapshot(), lockedUntil: '2026-07-29T12:14:59.999Z' } }
    ] as const

    for (const override of invalidInputs) {
      expectSafeValidationError(
        captureError(() =>
          parseUpdateLocalUserAuthenticationStateInput({
            ...createValidMutationInput(),
            ...override
          })
        )
      )
    }
  })

  it('allows a first successful login timestamp when no previous login exists', () => {
    expect(
      parseUpdateLocalUserAuthenticationStateInput({
        id: userId,
        expected: {
          ...createValidSnapshot(),
          lastLoginAt: null
        },
        next: {
          ...createValidNextSnapshot(),
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: attemptAt
        }
      })
    ).toMatchObject({
      next: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: attemptAt
      }
    })
  })

  it('keeps public barrels free of local-user SQL and credential persistence internals', () => {
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
      expect(source).not.toContain('selectLocalUser')
      expect(source).not.toContain('updateLocalUserAuthenticationStateSql')
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
    failedLoginCount: 2,
    lockedUntil: null,
    lastLoginAt: previousLoginAt,
    updatedAt: expectedUpdatedAt
  }
}

function createValidNextSnapshot(): Record<string, unknown> {
  return {
    failedLoginCount: 3,
    lockedUntil: futureLockUntil,
    lastLoginAt: previousLoginAt,
    updatedAt: attemptAt
  }
}

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    userId,
    previousLoginAt,
    expectedUpdatedAt,
    attemptAt,
    futureLockUntil,
    '12:09:59',
    '12:14:59',
    'secret',
    'C:\\',
    'SELECT',
    'users',
    'password',
    'hash',
    'salt',
    '-1',
    '1.25'
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
