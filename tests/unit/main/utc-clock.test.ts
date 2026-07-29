import { describe, expect, it } from 'vitest'

import {
  createSystemUtcClock,
  createUtcClock,
  parseUtcTimestamp,
  UtcClockError
} from '@main/foundation'

const canonicalTimestamp = '2026-07-29T12:34:56.789Z'

describe('UTC clock foundation', () => {
  it('creates canonical millisecond UTC timestamps with the system clock', () => {
    const clock = createSystemUtcClock(() => new Date(canonicalTimestamp))

    expect(clock.now()).toBe(canonicalTimestamp)
  })

  it('supports deterministic injection while still validating timestamps', () => {
    const clock = createUtcClock(() => canonicalTimestamp)

    expect(clock.now()).toBe(canonicalTimestamp)
    expect(parseUtcTimestamp(canonicalTimestamp)).toBe(canonicalTimestamp)
  })

  it('rejects malformed or non-canonical UTC values without leaking raw values', () => {
    const invalidValues: readonly unknown[] = [
      '',
      '2026-07-29T12:34:56Z',
      '2026-07-29T12:34:56.789+00:00',
      '2026-02-30T12:34:56.789Z',
      'C:\\secret\\patient.sqlite3',
      null
    ]

    for (const invalidValue of invalidValues) {
      const error = captureError(() => parseUtcTimestamp(invalidValue))

      expectSafeUtcClockError(error)
      if (typeof invalidValue === 'string' && invalidValue.length > 0) {
        expect(JSON.stringify(error)).not.toContain(invalidValue)
      }
    }
  })

  it('sanitizes system clock failures and omits raw causes', () => {
    const error = captureError(() => createSystemUtcClock(() => new Date(Number.NaN)).now())

    expectSafeUtcClockError(error)
    expect((error as UtcClockError).errorType).toBe('RangeError')
  })

  it('sanitizes injected provider failures', () => {
    const rawError = new Error('C:\\secret\\clock.sqlite3 SELECT * FROM audit_log')
    rawError.name = 'C:\\secret\\ClockError'
    const error = captureError(() =>
      createUtcClock(() => {
        throw rawError
      }).now()
    )

    expectSafeUtcClockError(error)
    expect((error as UtcClockError).errorType).toBe('UnknownError')
    expect(JSON.stringify(error)).not.toContain('secret')
    expect(JSON.stringify(error)).not.toContain('audit_log')
  })

  it('maps safe-looking provider names to UnknownError', () => {
    const safeLookingNames = ['users', 'PatientName', 'Emmanuel', 'passwordHash'] as const

    for (const name of safeLookingNames) {
      const rawError = new Error('C:\\secret\\clock.sqlite3 SELECT passwordHash')
      rawError.name = name

      const error = captureError(() =>
        createUtcClock(() => {
          throw rawError
        }).now()
      )

      expectSafeUtcClockError(error)
      expect((error as UtcClockError).errorType).toBe('UnknownError')
      expect(JSON.stringify(error)).not.toContain(name)
    }
  })

  it('rebuilds mutated controlled provider errors without enumerable secrets', () => {
    const incoming = new UtcClockError('RangeError') as UtcClockError & {
      cause: Error
      passwordHash: string
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\cause.sqlite3')
    incoming.passwordHash = 'patient-secret'
    incoming.stack = 'C:\\secret\\stack.sqlite3'

    const error = captureError(() =>
      createUtcClock(() => {
        throw incoming
      }).now()
    )

    expectSafeUtcClockError(error)
    expect(error).not.toBe(incoming)
    expect((error as UtcClockError).errorType).toBe('RangeError')
    expect(JSON.stringify(error)).not.toContain('passwordHash')
    expect(JSON.stringify(error)).not.toContain('patient-secret')
  })
})

function expectSafeUtcClockError(error: unknown): void {
  expect(error).toBeInstanceOf(UtcClockError)
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
