import { describe, expect, it } from 'vitest'

import { parseDeploymentName, parseIanaTimeZone, RepositoryValidationError } from '@main/database'

describe('installation validation', () => {
  it('canonicalizes valid deployment names without changing display case', () => {
    expect(parseDeploymentName('  North\u00a0Field\u2003Clinic  ')).toBe('North Field Clinic')
    expect(parseDeploymentName('Ｃａｍｅｒｏｏｎ Ｐｉｌｏｔ')).toBe('Cameroon Pilot')
    expect(parseDeploymentName('Douala Mobile Unit')).toBe('Douala Mobile Unit')
    expect(parseDeploymentName('A'.repeat(120))).toBe('A'.repeat(120))
  })

  it('rejects unsafe deployment names without leaking values', () => {
    const invalidValues: readonly unknown[] = [
      '',
      '   ',
      'A'.repeat(121),
      'Secret\u0000Deployment',
      'Secret\nDeployment',
      'Secret\u2028Deployment',
      'Secret\u2029Deployment',
      'Secret\uD800Deployment',
      null
    ]

    for (const invalidValue of invalidValues) {
      const error = captureError(() => parseDeploymentName(invalidValue))

      expectSafeValidationError(error)
      expect(JSON.stringify(error)).not.toContain('Secret')
      expect(JSON.stringify(error)).not.toContain('Deployment')
    }
  })

  it('validates and canonicalizes IANA timezones with built-in Intl support', () => {
    expect(parseIanaTimeZone('Africa/Douala')).toBe(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Douala' }).resolvedOptions().timeZone
    )
    expect(parseIanaTimeZone('UTC')).toBe(
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone
    )
  })

  it('rejects unsafe timezone values without leaking values', () => {
    const invalidValues: readonly unknown[] = [
      '',
      ' Africa/Douala',
      'Africa/Douala ',
      'Africa/ Douala',
      'Invalid/Zone',
      '+01:00',
      '-05:00',
      '+05:30',
      'A'.repeat(65),
      'Africa/\u0000Douala',
      null
    ]

    for (const invalidValue of invalidValues) {
      const error = captureError(() => parseIanaTimeZone(invalidValue))

      expectSafeValidationError(error)
      expect(JSON.stringify(error)).not.toContain('Africa')
      expect(JSON.stringify(error)).not.toContain('Invalid')
      expect(JSON.stringify(error)).not.toContain('Douala')
      expect(JSON.stringify(error)).not.toContain('+01:00')
      expect(JSON.stringify(error)).not.toContain('-05:00')
      expect(JSON.stringify(error)).not.toContain('+05:30')
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
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
