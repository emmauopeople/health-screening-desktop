import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  normalizePatientPhone,
  normalizePatientSearchText,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  type PatientCreateRequest,
  type PublicPatientSummary,
  type UtcTimestamp
} from '@shared/ipc'

const validPatientId = '00000000-0000-4000-8000-000000000001'
const validRevision = '2026-08-03T12:00:00.000Z' as UtcTimestamp

const validRegistrationDraft = {
  givenName: 'Alice',
  middleName: null,
  familyName: 'Tangwa',
  sex: 'FEMALE',
  dateOfBirth: '1990-05-12',
  approximateAgeYears: null,
  approximateAgeAsOfDate: null,
  village: 'Nkwen',
  quarter: 'Upper',
  phone: '+1 312 555 0101'
} as const

const publicPatient: PublicPatientSummary = {
  patientId: validPatientId,
  patientCode: 'PT-000001',
  displayName: 'Alice Tangwa',
  status: 'ACTIVE',
  sex: 'FEMALE',
  dateOfBirth: '1990-05-12',
  approximateAgeYears: null,
  approximateAgeAsOfDate: null,
  ageDobDisplay: 'DOB 1990-05-12',
  village: 'Nkwen',
  quarter: 'Upper',
  phoneAvailable: true,
  lastScreening: null,
  referralFollowUp: null,
  revision: validRevision
}

describe('patient IPC contracts', () => {
  it('normalizes search text and phone values deterministically', () => {
    expect(normalizePatientSearchText('  Alice   Tangwa  ')).toBe('alice tangwa')
    expect(normalizePatientPhone('+1 (312) 555-0101')).toBe('13125550101')
    expect(normalizePatientPhone('not recorded')).toBe(null)
    expect(normalizePatientPhone(null)).toBe(null)
  })

  it('accepts bounded patient search requests and rejects unsupported pagination or fields', () => {
    expect(
      patientSearchRequestSchema.parse({
        query: 'Alice',
        filters: {
          dateOfBirth: '1990-05-12',
          approximateAgeYears: null,
          sex: 'FEMALE',
          village: 'Nkwen',
          quarter: 'Upper'
        },
        page: 1,
        pageSize: 25
      })
    ).toEqual({
      query: 'Alice',
      filters: {
        dateOfBirth: '1990-05-12',
        approximateAgeYears: null,
        sex: 'FEMALE',
        village: 'Nkwen',
        quarter: 'Upper'
      },
      page: 1,
      pageSize: 25
    })

    expect(patientSearchRequestSchema.safeParse({ pageSize: 10 }).success).toBe(false)
    expect(patientSearchRequestSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(patientSearchRequestSchema.safeParse({ query: 'A'.repeat(161) }).success).toBe(false)
    expect(patientSearchRequestSchema.safeParse({ filters: { extra: true } }).success).toBe(false)
  })

  it('requires exactly one DOB or approximate-age identity and a reference date for approximate age', () => {
    expect(patientFindDuplicatesRequestSchema.parse(validRegistrationDraft)).toEqual(
      validRegistrationDraft
    )
    expect(
      patientFindDuplicatesRequestSchema.parse({
        ...validRegistrationDraft,
        dateOfBirth: null,
        approximateAgeYears: 42,
        approximateAgeAsOfDate: '2026-08-03'
      })
    ).toEqual({
      ...validRegistrationDraft,
      dateOfBirth: null,
      approximateAgeYears: 42,
      approximateAgeAsOfDate: '2026-08-03'
    })

    expect(
      patientFindDuplicatesRequestSchema.safeParse({
        ...validRegistrationDraft,
        dateOfBirth: null,
        approximateAgeYears: null,
        approximateAgeAsOfDate: null
      }).success
    ).toBe(false)
    expect(
      patientFindDuplicatesRequestSchema.safeParse({
        ...validRegistrationDraft,
        approximateAgeYears: 42,
        approximateAgeAsOfDate: '2026-08-03'
      }).success
    ).toBe(false)
    expect(
      patientFindDuplicatesRequestSchema.safeParse({
        ...validRegistrationDraft,
        dateOfBirth: null,
        approximateAgeYears: 42,
        approximateAgeAsOfDate: null
      }).success
    ).toBe(false)
  })

  it('validates create requests and public result envelopes without clinical fake data', () => {
    const request: PatientCreateRequest = {
      ...validRegistrationDraft,
      acknowledgmentStatus: 'ACKNOWLEDGED',
      acknowledgmentReference: null,
      reviewedDuplicateToken: null
    }

    expect(patientCreateRequestSchema.parse(request)).toEqual(request)
    expect(
      patientCreateRequestSchema.safeParse({ ...request, acknowledgmentStatus: 'YES' }).success
    ).toBe(false)

    expect(
      patientSearchResultSchema.parse(
        createIpcSuccess({
          rows: [publicPatient],
          total: 1,
          page: 1,
          pageSize: 25
        })
      )
    ).toEqual(
      createIpcSuccess({
        rows: [publicPatient],
        total: 1,
        page: 1,
        pageSize: 25
      })
    )
    expect(
      patientCreateResultSchema.parse(
        createIpcSuccess({
          status: 'CREATED',
          patient: publicPatient
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'CREATED',
        patient: publicPatient
      })
    )
    expect(
      patientSearchResultSchema.safeParse(
        createIpcSuccess({
          rows: [{ ...publicPatient, lastScreening: '2026-08-03' }],
          total: 1,
          page: 1,
          pageSize: 25
        })
      ).success
    ).toBe(false)
  })
})
