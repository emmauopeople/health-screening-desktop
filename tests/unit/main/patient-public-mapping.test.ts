import { describe, expect, it } from 'vitest'

import {
  toPublicAcknowledgmentHistoryRecord,
  toPublicDemographicAmendmentRecord,
  toPublicPatientDetail,
  toPublicPatientDuplicateCandidate,
  toPublicPatientDuplicatePair,
  toPublicPatientSummary
} from '@main/application/patients/patient-public-mapping'
import type {
  PatientAcknowledgmentRecord,
  PatientDemographicAmendmentRecord,
  PatientDetailRecord,
  PatientDuplicateCandidateRecord,
  PatientDuplicatePairRecord,
  PatientSummaryRecord
} from '@main/database'
import type { EntityId, UtcTimestamp } from '@main/foundation'

const patientId = '11111111-1111-4111-8111-111111111111' as EntityId
const secondPatientId = '22222222-2222-4222-8222-222222222222' as EntityId
const actorId = '33333333-3333-4333-8333-333333333333' as EntityId
const amendmentId = '44444444-4444-4444-8444-444444444444' as EntityId
const acknowledgmentId = '55555555-5555-4555-8555-555555555555' as EntityId
const timestamp = '2026-07-29T12:34:56.789Z' as UtcTimestamp

describe('patient public mapping', () => {
  it('preserves existing summary, detail, duplicate candidate, and duplicate pair output', () => {
    const summary = createSummaryRecord()
    const detail = createDetailRecord()
    const matchedOn = Object.freeze(['name', 'phone'])
    const candidate: PatientDuplicateCandidateRecord = Object.freeze({
      patient: summary,
      matchedOn,
      score: 92
    })
    const pair: PatientDuplicatePairRecord = Object.freeze({
      pairKey: `${patientId}:${secondPatientId}`,
      first: summary,
      second: { ...summary, id: secondPatientId, patientCode: 'PT-000002' as never },
      matchedOn,
      score: 88
    })

    expect(toPublicPatientSummary(summary)).toEqual({
      id: patientId,
      patientCode: 'PT-000001',
      displayName: 'Test Patient',
      givenName: 'Test',
      familyName: 'Patient',
      otherNames: null,
      dateOfBirth: '1990-01-01',
      approximateAgeYears: null,
      ageAsOfDate: null,
      sex: 'FEMALE',
      village: 'Test Buea',
      quarter: 'Test Quarter',
      phone: '650 555 0100',
      status: 'ACTIVE',
      rowVersion: 2,
      updatedAt: timestamp
    })
    expect(toPublicPatientDetail(detail)).toEqual({
      ...toPublicPatientSummary(summary),
      alternateContactName: 'Test Contact',
      alternateContactPhone: '650 555 0101',
      residenceNotes: 'Synthetic residence note.',
      acknowledgment: {
        status: 'ACKNOWLEDGED',
        recordedAt: timestamp,
        recordedByDisplayName: 'Admin User'
      },
      createdAt: timestamp,
      createdByDisplayName: 'Admin User',
      updatedByDisplayName: 'Nurse User',
      clinicalStatus: 'NOT_AVAILABLE'
    })
    expect(toPublicPatientDuplicateCandidate(candidate)).toEqual({
      patient: toPublicPatientSummary(summary),
      matchedOn: ['name', 'phone'],
      score: 92,
      status: 'POSSIBLE_DUPLICATE'
    })
    expect(toPublicPatientDuplicateCandidate(candidate).matchedOn).not.toBe(matchedOn)
    expect(toPublicPatientDuplicatePair(pair)).toEqual({
      pairKey: `${patientId}:${secondPatientId}`,
      first: toPublicPatientSummary(summary),
      second: toPublicPatientSummary(pair.second),
      matchedOn: ['name', 'phone'],
      score: 88,
      status: 'POSSIBLE_DUPLICATE'
    })
    expect(toPublicPatientDuplicatePair(pair).matchedOn).not.toBe(matchedOn)
  })

  it('maps every demographic amendment field to public camelCase in existing order', () => {
    const record = createDemographicAmendmentRecord()
    const mapped = toPublicDemographicAmendmentRecord(record)

    expect(mapped).toMatchObject({
      amendmentId,
      patientId,
      priorRowVersion: 2,
      resultingRowVersion: 3,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: 'Corrected synthetic data.',
      amendedByUserId: actorId,
      amendedByDisplayName: 'Admin User',
      amendedAt: timestamp
    })
    expect(mapped.changes.map((change) => change.fieldName)).toEqual([
      'givenName',
      'familyName',
      'otherNames',
      'dateOfBirth',
      'approximateAgeYears',
      'ageAsOfDate',
      'sex',
      'village',
      'quarter',
      'phone',
      'alternateContactName',
      'alternateContactPhone',
      'residenceNotes',
      'status'
    ])
    expect(mapped.changes[0]).toEqual({
      fieldName: 'givenName',
      previousValue: 'Tset',
      newValue: 'Test'
    })
    expect(mapped.changes).not.toBe(record.changes)
    expect(JSON.stringify(mapped)).not.toContain('given_name')
    expect(JSON.stringify(mapped)).not.toContain('amended_by')
  })

  it('maps acknowledgment history without physical consent terminology', () => {
    const record: PatientAcknowledgmentRecord = Object.freeze({
      id: acknowledgmentId,
      patientId,
      status: 'NOT_REQUESTED',
      sourceType: 'LOCAL',
      note: null,
      recordedBy: actorId,
      recordedByDisplayName: 'Admin User',
      recordedAt: timestamp,
      priorRowVersion: null,
      resultingRowVersion: null
    })

    const mapped = toPublicAcknowledgmentHistoryRecord(record)

    expect(mapped).toEqual({
      acknowledgmentId,
      patientId,
      status: 'NOT_REQUESTED',
      sourceType: 'LOCAL',
      note: null,
      recordedByUserId: actorId,
      recordedByDisplayName: 'Admin User',
      recordedAt: timestamp,
      priorRowVersion: null,
      resultingRowVersion: null
    })
    expect(JSON.stringify(mapped)).not.toContain('consent')
    expect(JSON.stringify(mapped)).not.toContain('recorded_by')
  })
})

function createSummaryRecord(): PatientSummaryRecord {
  return Object.freeze({
    id: patientId,
    patientCode: 'PT-000001' as never,
    displayName: 'Test Patient' as never,
    givenName: 'Test',
    familyName: 'Patient',
    otherNames: null,
    dateOfBirth: '1990-01-01',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Test Buea',
    quarter: 'Test Quarter',
    phone: '650 555 0100',
    status: 'ACTIVE',
    rowVersion: 2,
    updatedAt: timestamp
  })
}

function createDetailRecord(): PatientDetailRecord {
  return Object.freeze({
    ...createSummaryRecord(),
    alternateContactName: 'Test Contact',
    alternateContactPhone: '650 555 0101',
    residenceNotes: 'Synthetic residence note.',
    acknowledgmentStatus: 'ACKNOWLEDGED',
    acknowledgmentRecordedAt: timestamp,
    acknowledgmentRecordedByDisplayName: 'Admin User',
    createdAt: timestamp,
    createdByDisplayName: 'Admin User',
    updatedByDisplayName: 'Nurse User'
  })
}

function createDemographicAmendmentRecord(): PatientDemographicAmendmentRecord {
  return Object.freeze({
    id: amendmentId,
    patientId,
    priorRowVersion: 2,
    resultingRowVersion: 3,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: 'Corrected synthetic data.',
    amendedBy: actorId,
    amendedByDisplayName: 'Admin User',
    amendedAt: timestamp,
    changes: Object.freeze([
      change('given_name', 'Tset', 'Test'),
      change('family_name', 'Patinet', 'Patient'),
      change('other_names', null, 'Middle'),
      change('date_of_birth', null, '1990-01-01'),
      change('approximate_age_years', 30, null),
      change('age_as_of_date', '2026-01-01', null),
      change('sex', 'UNKNOWN', 'FEMALE'),
      change('village', null, 'Test Buea'),
      change('quarter', null, 'Test Quarter'),
      change('phone', null, '650 555 0100'),
      change('alternate_contact_name', null, 'Test Contact'),
      change('alternate_contact_phone', null, '650 555 0101'),
      change('residence_notes', null, 'Synthetic residence note.'),
      change('status', 'ACTIVE', 'INACTIVE')
    ])
  })
}

function change(
  fieldName: PatientDemographicAmendmentRecord['changes'][number]['fieldName'],
  previousValue: PatientDemographicAmendmentRecord['changes'][number]['previousValue'],
  newValue: PatientDemographicAmendmentRecord['changes'][number]['newValue']
): PatientDemographicAmendmentRecord['changes'][number] {
  return Object.freeze({
    fieldName,
    previousValue,
    newValue
  })
}
