import { describe, expect, it } from 'vitest'

import {
  formatPatientCode,
  normalizeDuplicateReasonCodes,
  normalizePatientEditableFields,
  RepositoryValidationError
} from '@main/database'
import type { PatientEditableFields } from '@shared/ipc'

const today = '2026-08-03'

describe('patient registry validation', () => {
  it('formats immutable local patient codes with a six digit sequence', () => {
    expect(formatPatientCode(1)).toBe('PT-000001')
    expect(formatPatientCode(999999)).toBe('PT-999999')
    expect(() => formatPatientCode(0)).toThrow(RepositoryValidationError)
    expect(() => formatPatientCode(1000000)).toThrow(RepositoryValidationError)
  })

  it('trims names, preserves phone display, and stores normalized phone digits', () => {
    const normalized = normalizePatientEditableFields(
      createFields({
        givenName: '  Ada\tMarie  ',
        familyName: '  Biko  ',
        phone: ' 677 88 99 ',
        village: '  Melen   Quarter ',
        residenceNotes: '  Near  the market '
      }),
      { today }
    )

    expect(normalized.displayName).toBe('Ada Marie Biko')
    expect(normalized.nameNormalized).toBe('ada marie biko')
    expect(normalized.phone).toBe('677 88 99')
    expect(normalized.phoneNormalized).toBe('6778899')
    expect(normalized.village).toBe('Melen Quarter')
    expect(normalized.residenceNotes).toBe('Near the market')
  })

  it('rejects unsafe identity data before it reaches SQL', () => {
    for (const fields of [
      createFields({ givenName: 'Ada\u0001' }),
      createFields({ dateOfBirth: '2026-08-04' }),
      createFields({ dateOfBirth: null, approximateAgeYears: 121, ageAsOfDate: today }),
      createFields({ dateOfBirth: '1990-01-01', approximateAgeYears: 36, ageAsOfDate: today }),
      createFields({ dateOfBirth: null, approximateAgeYears: null, ageAsOfDate: null })
    ]) {
      expect(() => normalizePatientEditableFields(fields, { today })).toThrow(
        RepositoryValidationError
      )
    }
  })

  it('canonicalizes duplicate review reason codes deterministically', () => {
    expect(
      normalizeDuplicateReasonCodes([' manual review ', 'manual   review', 'looks different'])
    ).toEqual(['LOOKS_DIFFERENT', 'MANUAL_REVIEW'])
  })
})

function createFields(overrides: Partial<PatientEditableFields> = {}): PatientEditableFields {
  return {
    givenName: 'Ada',
    familyName: 'Biko',
    otherNames: null,
    dateOfBirth: '1990-01-01',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Melen',
    quarter: null,
    phone: null,
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    status: 'ACTIVE',
    acknowledgmentStatus: 'NOT_REQUESTED',
    ...overrides
  }
}
