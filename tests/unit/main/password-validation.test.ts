import { describe, expect, it } from 'vitest'

import { PasswordValidationError } from '@main/security'
import { parsePlaintextPassword } from '@main/security/password/password-validation'

describe('password validation', () => {
  it('accepts exact password strings at reviewed boundaries without transformation', () => {
    const minimum = 'abcdefghijkl'
    const maximum = 'A'.repeat(128)
    const maximumUtf8Bytes = '\u{1f600}'.repeat(128)
    const spaced = '  pass phrase  '
    const printableUnicode = 'Douala pass \u00e9!'

    expect(parsePlaintextPassword(minimum)).toBe(minimum)
    expect(parsePlaintextPassword(maximum)).toBe(maximum)
    expect(Buffer.byteLength(maximumUtf8Bytes, 'utf8')).toBe(512)
    expect(parsePlaintextPassword(maximumUtf8Bytes)).toBe(maximumUtf8Bytes)
    expect(parsePlaintextPassword(spaced)).toBe(spaced)
    expect(parsePlaintextPassword(printableUnicode)).toBe(printableUnicode)
  })

  it('keeps visually similar Unicode and whitespace-distinct passwords distinct', () => {
    const composed = 'aaaaaaaaaaa\u00e9'
    const decomposed = 'aaaaaaaaaaae\u0301'
    const withPadding = ' password1234 '
    const withoutPadding = 'password1234'

    expect(parsePlaintextPassword(composed)).toBe(composed)
    expect(parsePlaintextPassword(decomposed)).toBe(decomposed)
    expect(parsePlaintextPassword(composed)).not.toBe(parsePlaintextPassword(decomposed))
    expect(parsePlaintextPassword(withPadding)).toBe(withPadding)
    expect(parsePlaintextPassword(withPadding)).not.toBe(parsePlaintextPassword(withoutPadding))
  })

  it('rejects unsafe password input without leaking secret metadata', () => {
    const invalidValues: readonly unknown[] = [
      '',
      'a'.repeat(11),
      'A'.repeat(129),
      'SecretPassw\u0000rd!',
      'SecretPassw\nrd!',
      'SecretPassw\u0085rd!',
      'SecretPassw\u2028rd!',
      'SecretPassw\u2029rd!',
      'SecretPassw\uD800rd!',
      null
    ]

    for (const invalidValue of invalidValues) {
      const error = captureError(() => parsePlaintextPassword(invalidValue))

      expectSafeValidationError(error)
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(error).toBeInstanceOf(PasswordValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of ['SecretPassw', 'rd!', 'length', 'byte', '129', '11']) {
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
