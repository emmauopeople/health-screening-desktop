import { describe, expect, it } from 'vitest'

import {
  createEntityIdGenerator,
  createSystemEntityIdGenerator,
  EntityIdGenerationError,
  parseEntityId
} from '@main/foundation'

const canonicalEntityId = '01890f04-8a3b-4f89-b2db-83e4f0d971f3'
const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('entity ID foundation', () => {
  it('creates canonical lowercase UUID v4 entity IDs with the system provider', () => {
    const generator = createSystemEntityIdGenerator()
    const generatedIds = Array.from({ length: 32 }, () => generator.generate())

    expect(new Set(generatedIds).size).toBe(generatedIds.length)
    for (const generatedId of generatedIds) {
      expect(generatedId).toMatch(canonicalUuidV4Pattern)
    }
  })

  it('supports deterministic injection while still validating generated IDs', () => {
    const generator = createEntityIdGenerator(() => canonicalEntityId)

    expect(generator.generate()).toBe(canonicalEntityId)
    expect(parseEntityId(canonicalEntityId)).toBe(canonicalEntityId)
  })

  it('rejects non-canonical UUID values without leaking raw values', () => {
    const invalidValues: readonly unknown[] = [
      '',
      '01890F04-8A3B-4F89-B2DB-83E4F0D971F3',
      '01890f04-8a3b-3f89-b2db-83e4f0d971f3',
      '01890f04-8a3b-4f89-72db-83e4f0d971f3',
      'C:\\secret\\patient.sqlite3',
      null
    ]

    for (const invalidValue of invalidValues) {
      const error = captureError(() => parseEntityId(invalidValue))

      expectSafeEntityIdError(error)
      if (typeof invalidValue === 'string' && invalidValue.length > 0) {
        expect(JSON.stringify(error)).not.toContain(invalidValue)
      }
    }
  })

  it('sanitizes provider failures and omits raw causes', () => {
    const rawError = new Error('C:\\secret\\patient.sqlite3 SELECT * FROM patients')
    rawError.name = 'C:\\secret\\SqliteError'
    const error = captureError(() =>
      createEntityIdGenerator(() => {
        throw rawError
      }).generate()
    )

    expectSafeEntityIdError(error)
    expect((error as EntityIdGenerationError).errorType).toBe('UnknownError')
    expect(JSON.stringify(error)).not.toContain('secret')
    expect(JSON.stringify(error)).not.toContain('patients')
  })
})

function expectSafeEntityIdError(error: unknown): void {
  expect(error).toBeInstanceOf(EntityIdGenerationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(JSON.stringify(error)).not.toContain('stack')
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
