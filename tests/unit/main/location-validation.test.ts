import { describe, expect, it } from 'vitest'

import {
  decodeSqliteLocationBoolean,
  parseLocationAdministrativeArea,
  parseLocationDirections,
  parseLocationNameIdentity,
  parseLocationType,
  RepositoryValidationError
} from '@main/database'

describe('location validation', () => {
  it('canonicalizes reviewed location names and normalized keys', () => {
    expect(parseLocationNameIdentity('  St.\u00a0Peter   Church  ')).toEqual({
      name: 'St. Peter Church',
      nameNormalized: 'st. peter church'
    })
    expect(parseLocationNameIdentity('\uFF33aint Anne')).toEqual({
      name: 'Saint Anne',
      nameNormalized: 'saint anne'
    })
    expect(parseLocationNameIdentity('\u00c9glise Centrale')).toEqual({
      name: '\u00c9glise Centrale',
      nameNormalized: '\u00e9glise centrale'
    })

    const maximumName = `A${'b'.repeat(118)}9`
    expect(parseLocationNameIdentity(maximumName)).toEqual({
      name: maximumName,
      nameNormalized: maximumName.toLowerCase()
    })
  })

  it('rejects unsafe location names with clean validation errors', () => {
    for (const value of [
      '',
      '   ',
      '---',
      "'''",
      `A${'b'.repeat(120)}`,
      'Clinic\u0000Name',
      'Clinic\nName',
      'Clinic\tName',
      'Line\u2028Break',
      'Paragraph\u2029Break',
      '\ud800Clinic',
      '\udc00Clinic',
      12,
      null,
      {}
    ]) {
      expectSafeValidationError(captureError(() => parseLocationNameIdentity(value)))
    }
  })

  it('strictly validates location types and SQLite booleans', () => {
    expect(parseLocationType('CHURCH')).toBe('CHURCH')
    expect(parseLocationType('QUARTER')).toBe('QUARTER')
    expect(parseLocationType('VILLAGE')).toBe('VILLAGE')
    expect(parseLocationType('COMMUNITY_SITE')).toBe('COMMUNITY_SITE')
    expect(parseLocationType('OTHER')).toBe('OTHER')
    expect(decodeSqliteLocationBoolean(0)).toBe(false)
    expect(decodeSqliteLocationBoolean(1)).toBe(true)

    for (const value of ['church', 'CLINIC', '', 1, null, [], {}]) {
      expectSafeValidationError(captureError(() => parseLocationType(value)))
    }

    for (const value of [true, false, '1', null, 2, -1, 1.5]) {
      expectSafeValidationError(captureError(() => decodeSqliteLocationBoolean(value)))
    }
  })

  it('canonicalizes nullable administrative areas without inventing values', () => {
    expect(parseLocationAdministrativeArea(null)).toBeNull()
    expect(parseLocationAdministrativeArea('  Mfoundi\u00a0I   Quarter  ')).toBe(
      'Mfoundi I Quarter'
    )
    expect(parseLocationAdministrativeArea('\uFF24ouala 3')).toBe('Douala 3')

    const maximumArea = `A${'b'.repeat(118)}9`
    expect(parseLocationAdministrativeArea(maximumArea)).toBe(maximumArea)
  })

  it('rejects unsafe administrative areas with clean validation errors', () => {
    for (const value of [
      '',
      '   ',
      '---',
      `A${'b'.repeat(120)}`,
      'Village\u0000Name',
      'Village\nName',
      'Line\u2028Break',
      '\ud800Village',
      12,
      undefined
    ]) {
      expectSafeValidationError(captureError(() => parseLocationAdministrativeArea(value)))
    }
  })

  it('canonicalizes nullable directions as printable inert text', () => {
    expect(parseLocationDirections(null)).toBeNull()
    expect(parseLocationDirections('  Opposite\u00a0market   gate.  ')).toBe(
      'Opposite market gate.'
    )
    expect(parseLocationDirections('!!!')).toBe('!!!')

    const maximumDirections = 'A'.repeat(500)
    expect(parseLocationDirections(maximumDirections)).toBe(maximumDirections)
  })

  it('rejects unsafe directions with clean validation errors', () => {
    for (const value of [
      '',
      '   ',
      'A'.repeat(501),
      'Road\u0000Name',
      'Road\nName',
      'Line\u2028Break',
      '\udc00Road',
      12,
      undefined
    ]) {
      expectSafeValidationError(captureError(() => parseLocationDirections(value)))
    }
  })
})

function expectSafeValidationError(error: unknown): void {
  expect(error).toBeInstanceOf(RepositoryValidationError)
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)
  for (const unsafeFragment of [
    'Clinic',
    'Village',
    'Road',
    'St. Peter',
    '\u00c9glise',
    'SELECT',
    'C:\\',
    'password',
    'salt',
    'hash'
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
