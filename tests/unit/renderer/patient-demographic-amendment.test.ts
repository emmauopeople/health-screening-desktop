import { describe, expect, it } from 'vitest'

import type { PublicPatientDetail } from '@shared/ipc'
import {
  applyPatientDemographicPatch,
  applyPatientDemographicPatchToDraft,
  createPatientDemographicDraft,
  createPatientDemographicPatch,
  getPatientDemographicChangedFields,
  getPatientDemographicConflictFields,
  patientDemographicDraftFieldOrder,
  updatePatientDemographicDraftField,
  validatePatientDemographicAmendment
} from '../../../src/renderer/src/app/patients/patient-demographic-amendment'

const baseTimestamp = '2026-08-03T12:00:00.000Z'
const patientId = '11111111-1111-4111-8111-111111111111'
const today = '2026-08-05'

describe('patient demographic amendment helpers', () => {
  it('creates a demographic-only draft for all 14 amendable fields', () => {
    const draft = createPatientDemographicDraft(patientDetail())

    expect(Object.keys(draft)).toEqual([...patientDemographicDraftFieldOrder])
    expect(draft).toEqual({
      givenName: 'Ada',
      familyName: 'Ngono',
      otherNames: null,
      dateOfBirth: '1990-01-02',
      approximateAgeYears: null,
      ageAsOfDate: null,
      sex: 'FEMALE',
      village: 'Bastos',
      quarter: 'East',
      phone: '+237 600 000 001',
      alternateContactName: null,
      alternateContactPhone: null,
      residenceNotes: null,
      status: 'ACTIVE'
    })
  })

  it('builds canonical changed-field patches and omits unchanged metadata', () => {
    const base = patientDetail()
    const draft = {
      ...createPatientDemographicDraft(base),
      familyName: 'Muna',
      otherNames: null,
      phone: null,
      status: 'INACTIVE' as const
    }

    const patch = createPatientDemographicPatch(base, draft)

    expect(patch).toEqual({
      familyName: 'Muna',
      phone: null,
      status: 'INACTIVE'
    })
    expect(Object.keys(patch ?? {})).toEqual(['familyName', 'phone', 'status'])
    expect(patch).not.toHaveProperty('acknowledgmentStatus')
    expect(patch).not.toHaveProperty('rowVersion')
    expect(getPatientDemographicChangedFields(base, draft)).toEqual([
      'familyName',
      'phone',
      'status'
    ])
  })

  it('returns no patch for no-op drafts and applies patches only to listed fields', () => {
    const base = patientDetail()
    const patch = createPatientDemographicPatch(base, createPatientDemographicDraft(base))

    expect(patch).toBeNull()

    const applied = applyPatientDemographicPatch(base, {
      village: 'Mendankwe',
      residenceNotes: null
    })

    expect(applied.village).toBe('Mendankwe')
    expect(applied.residenceNotes).toBeNull()
    expect(applied.givenName).toBe(base.givenName)
    expect(applied.acknowledgment.status).toBe('NOT_REQUESTED')
  })

  it('validates reason, note, name, age, and status rules', () => {
    const base = patientDetail()
    const changed = { ...createPatientDemographicDraft(base), village: 'Mendankwe' }

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: '',
        reasonNote: '',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonCode
    ).toBe('Select a reason for this demographic amendment.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'OTHER',
        reasonNote: '   ',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBe('Enter a reason note when Other is selected.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: { ...changed, status: 'INACTIVE' },
        reasonCode: 'DATA_ENTRY_CORRECTION',
        reasonNote: '',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBe('Enter a reason note when changing patient status.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: { ...changed, givenName: null, familyName: null, otherNames: null },
        reasonCode: 'DATA_ENTRY_CORRECTION',
        reasonNote: '',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.name
    ).toBe('At least one name field is required.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: {
          ...changed,
          dateOfBirth: null,
          approximateAgeYears: 34,
          ageAsOfDate: null
        },
        reasonCode: 'DATA_ENTRY_CORRECTION',
        reasonNote: '',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.ageAsOfDate
    ).toBe('Age as of date is required when approximate age is used.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'DATA_ENTRY_CORRECTION',
        reasonNote: '',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBeUndefined()
  })

  it('validates note length and unsafe Unicode', () => {
    const base = patientDetail()
    const changed = { ...createPatientDemographicDraft(base), village: 'Mendankwe' }
    const astralCharacter = '\u{1f642}'

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'OTHER',
        reasonNote: astralCharacter.repeat(500),
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBeUndefined()

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'OTHER',
        reasonNote: astralCharacter.repeat(501),
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBe('Reason note must be 500 characters or fewer.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'OTHER',
        reasonNote: 'unsafe\u0001note',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBe('Reason note contains unsupported control characters.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft: changed,
        reasonCode: 'OTHER',
        reasonNote: 'bad\uD800note',
        userRole: 'LOCAL_ADMIN',
        today
      }).errors.reasonNote
    ).toBe('Reason note contains unsupported characters.')
  })

  it('prevents trained screeners from submitting status changes', () => {
    const base = patientDetail()
    const draft = { ...createPatientDemographicDraft(base), status: 'INACTIVE' as const }

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft,
        reasonCode: 'STATUS_CHANGE',
        reasonNote: 'Status corrected.',
        userRole: 'TRAINED_SCREENER',
        today
      }).errors.status
    ).toBe('Only nurses and local administrators can change patient status.')

    expect(
      validatePatientDemographicAmendment({
        basePatient: base,
        draft,
        reasonCode: 'STATUS_CHANGE',
        reasonNote: 'Status corrected.',
        userRole: 'NURSE',
        today
      }).errors.status
    ).toBeUndefined()
  })

  it('supports exact DOB and approximate-age switching rules', () => {
    const exactDobDraft = createPatientDemographicDraft(patientDetail())
    const approximateDraft = updatePatientDemographicDraftField(
      { ...exactDobDraft, dateOfBirth: null },
      'approximateAgeYears',
      35,
      today
    )

    expect(approximateDraft.dateOfBirth).toBeNull()
    expect(approximateDraft.approximateAgeYears).toBe(35)
    expect(approximateDraft.ageAsOfDate).toBe(today)

    const clearedApproximate = updatePatientDemographicDraftField(
      approximateDraft,
      'approximateAgeYears',
      null,
      today
    )

    expect(clearedApproximate.ageAsOfDate).toBeNull()

    const dobDraft = updatePatientDemographicDraftField(
      { ...approximateDraft, dateOfBirth: null },
      'dateOfBirth',
      '1991-03-04',
      today
    )

    expect(dobDraft.dateOfBirth).toBe('1991-03-04')
    expect(dobDraft.approximateAgeYears).toBeNull()
    expect(dobDraft.ageAsOfDate).toBeNull()
  })

  it('rebases intended patches and reports overlapping conflict fields', () => {
    const original = patientDetail({ village: 'Bastos', phone: '+237 600 000 001' })
    const latest = patientDetail({
      village: 'Mendankwe',
      phone: '+237 600 000 002',
      quarter: 'North',
      rowVersion: 2
    })
    const intendedPatch = { village: 'Bamenda', familyName: 'Muna' }

    const rebased = applyPatientDemographicPatchToDraft(latest, intendedPatch, 'LOCAL_ADMIN')
    const overlaps = getPatientDemographicConflictFields(original, latest, intendedPatch)

    expect(rebased.village).toBe('Bamenda')
    expect(rebased.familyName).toBe('Muna')
    expect(rebased.phone).toBe('+237 600 000 002')
    expect(rebased.quarter).toBe('North')
    expect(overlaps).toEqual([
      {
        fieldName: 'village',
        originalValue: 'Bastos',
        latestValue: 'Mendankwe',
        intendedValue: 'Bamenda'
      }
    ])
  })
})

function patientDetail(overrides: Partial<PublicPatientDetail> = {}): PublicPatientDetail {
  const acknowledgment = overrides.acknowledgment ?? {
    status: 'NOT_REQUESTED',
    recordedAt: null,
    recordedByDisplayName: null
  }

  return {
    id: patientId,
    patientCode: 'PT-000001',
    displayName: 'Ada Ngono',
    givenName: 'Ada',
    familyName: 'Ngono',
    otherNames: null,
    dateOfBirth: '1990-01-02',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Bastos',
    quarter: 'East',
    phone: '+237 600 000 001',
    status: 'ACTIVE',
    rowVersion: 1,
    updatedAt: baseTimestamp,
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    acknowledgment,
    createdAt: baseTimestamp,
    createdByDisplayName: 'Admin User',
    updatedByDisplayName: 'Admin User',
    clinicalStatus: 'NOT_AVAILABLE',
    ...overrides
  }
}
