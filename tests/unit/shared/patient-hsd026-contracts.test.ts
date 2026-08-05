import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  ipcChannels,
  patientAmendDemographicsRequestSchema,
  patientAmendDemographicsResultSchema,
  patientAcknowledgmentDecisionStatusSchema,
  patientListAcknowledgmentHistoryResultSchema,
  patientListDemographicAmendmentHistoryResultSchema,
  patientRecordAcknowledgmentRequestSchema,
  patientRecordAcknowledgmentResultSchema,
  patientUpdateRequestSchema,
  publicPatientAcknowledgmentHistoryRecordSchema,
  publicPatientDemographicAmendmentRecordSchema
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const amendmentId = '33333333-3333-4333-8333-333333333333'
const acknowledgmentId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-07-29T12:34:56.789Z'

const publicPatient = {
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
  updatedAt: timestamp,
  alternateContactName: null,
  alternateContactPhone: null,
  residenceNotes: null,
  acknowledgment: {
    status: 'ACKNOWLEDGED',
    recordedAt: timestamp,
    recordedByDisplayName: 'Admin User'
  },
  createdAt: timestamp,
  createdByDisplayName: 'Admin User',
  updatedByDisplayName: 'Admin User',
  clinicalStatus: 'NOT_AVAILABLE'
} as const

const demographicRequest = {
  patientId,
  expectedRowVersion: 1,
  reasonCode: 'DATA_ENTRY_CORRECTION',
  reasonNote: 'Corrected synthetic spelling.',
  patch: {
    givenName: 'Test',
    village: null,
    sex: 'FEMALE',
    status: 'ACTIVE'
  }
} as const

const demographicRecord = {
  amendmentId,
  patientId,
  priorRowVersion: 1,
  resultingRowVersion: 2,
  reasonCode: 'DATA_ENTRY_CORRECTION',
  reasonNote: 'Corrected synthetic spelling.',
  amendedByUserId: actorId,
  amendedByDisplayName: 'Admin User',
  amendedAt: timestamp,
  changes: [
    {
      fieldName: 'givenName',
      previousValue: 'Tset',
      newValue: 'Test'
    },
    {
      fieldName: 'village',
      previousValue: null,
      newValue: 'Test Buea'
    }
  ]
} as const

const acknowledgmentRecord = {
  acknowledgmentId,
  patientId,
  status: 'ACKNOWLEDGED',
  sourceType: 'LOCAL',
  note: 'Synthetic participation/data-use acknowledgment note.',
  recordedByUserId: actorId,
  recordedByDisplayName: 'Admin User',
  recordedAt: timestamp,
  priorRowVersion: 1,
  resultingRowVersion: 2
} as const

describe('HSD-026 patient IPC contracts', () => {
  it('defines the exact new patient channel strings', () => {
    expect(ipcChannels.patient.amendDemographics).toBe(
      'health-screening:patient:amend-demographics'
    )
    expect(ipcChannels.patient.listDemographicAmendmentHistory).toBe(
      'health-screening:patient:list-demographic-amendment-history'
    )
    expect(ipcChannels.patient.recordAcknowledgment).toBe(
      'health-screening:patient:record-acknowledgment'
    )
    expect(ipcChannels.patient.listAcknowledgmentHistory).toBe(
      'health-screening:patient:list-acknowledgment-history'
    )
  })

  it('accepts valid demographic amendment requests and public results', () => {
    expect(patientAmendDemographicsRequestSchema.parse(demographicRequest)).toEqual(
      demographicRequest
    )
    expect(
      patientAmendDemographicsResultSchema.parse(
        createIpcSuccess({
          status: 'AMENDED',
          amendmentId,
          patient: publicPatient
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: publicPatient
      })
    )
    expect(
      patientAmendDemographicsResultSchema.parse(
        createIpcSuccess({
          status: 'PATIENT_VERSION_CONFLICT',
          patient: publicPatient
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: publicPatient
      })
    )
  })

  it('rejects empty, forbidden, unknown, missing, and unsafe demographic requests', () => {
    const getterRequest = { ...demographicRequest, patch: { givenName: 'Test' } }
    let getterInvoked = false

    Object.defineProperty(getterRequest.patch, 'givenName', {
      enumerable: true,
      get() {
        getterInvoked = true
        return 'Test'
      }
    })

    const cyclicRequest: Record<string, unknown> = { ...demographicRequest }
    cyclicRequest['self'] = cyclicRequest
    const symbolRequest = Object.defineProperty({ ...demographicRequest }, Symbol('patientId'), {
      enumerable: true,
      value: patientId
    })
    const proxyRequest = new Proxy(
      { ...demographicRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\patient.sqlite3')
        }
      }
    )

    for (const value of [
      { ...demographicRequest, patch: {} },
      { ...demographicRequest, patch: { acknowledgmentStatus: 'ACKNOWLEDGED' } },
      { ...demographicRequest, patch: { patientCode: 'PT-000001' } },
      { ...demographicRequest, patch: { patientId } },
      { ...demographicRequest, patch: { displayName: 'Test Patient' } },
      { ...demographicRequest, patch: { nameNormalized: 'test patient' } },
      { ...demographicRequest, extra: true },
      { ...demographicRequest, reasonNote: undefined },
      { ...demographicRequest, patch: { sex: null } },
      { ...demographicRequest, patch: { status: null } },
      Object.assign(Object.create({ patientId }), demographicRequest),
      getterRequest,
      symbolRequest,
      cyclicRequest,
      proxyRequest
    ]) {
      expect(patientAmendDemographicsRequestSchema.safeParse(value).success).toBe(false)
    }

    expect(getterInvoked).toBe(false)
  })

  it('validates bounded amendment and acknowledgment note text safely', () => {
    expect(
      patientAmendDemographicsRequestSchema.safeParse({
        ...demographicRequest,
        reasonNote: 'a'.repeat(500)
      }).success
    ).toBe(true)
    expect(
      patientRecordAcknowledgmentRequestSchema.safeParse({
        patientId,
        expectedRowVersion: 1,
        status: 'ACKNOWLEDGED',
        note: 'a'.repeat(500)
      }).success
    ).toBe(true)

    for (const note of ['a'.repeat(501), 'Unsafe\nnote', 'Unsafe\uD800note']) {
      expect(
        patientAmendDemographicsRequestSchema.safeParse({ ...demographicRequest, reasonNote: note })
          .success
      ).toBe(false)
      expect(
        patientRecordAcknowledgmentRequestSchema.safeParse({
          patientId,
          expectedRowVersion: 1,
          status: 'ACKNOWLEDGED',
          note
        }).success
      ).toBe(false)
    }
  })

  it('accepts public demographic history and rejects internal or noncanonical output', () => {
    expect(publicPatientDemographicAmendmentRecordSchema.parse(demographicRecord)).toEqual(
      demographicRecord
    )
    expect(
      patientListDemographicAmendmentHistoryResultSchema.parse(
        createIpcSuccess({
          items: [demographicRecord],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    ).toEqual(
      createIpcSuccess({
        items: [demographicRecord],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )

    for (const record of [
      { ...demographicRecord, consent_type: 'PATIENT_REGISTRY_ACKNOWLEDGMENT' },
      { ...demographicRecord, tableName: 'patient_demographic_amendments' },
      { ...demographicRecord, amended_by: actorId },
      {
        ...demographicRecord,
        changes: [
          demographicRecord.changes[0],
          { ...demographicRecord.changes[0], newValue: 'Duplicate' }
        ]
      },
      {
        ...demographicRecord,
        changes: [demographicRecord.changes[1], demographicRecord.changes[0]]
      },
      { ...demographicRecord, resultingRowVersion: 3 }
    ]) {
      expect(publicPatientDemographicAmendmentRecordSchema.safeParse(record).success).toBe(false)
    }
  })

  it('accepts acknowledgment commands and rejects NOT_REQUESTED commands', () => {
    expect(patientAcknowledgmentDecisionStatusSchema.parse('ACKNOWLEDGED')).toBe('ACKNOWLEDGED')
    expect(patientAcknowledgmentDecisionStatusSchema.parse('DECLINED')).toBe('DECLINED')
    expect(patientAcknowledgmentDecisionStatusSchema.safeParse('NOT_REQUESTED').success).toBe(false)
    expect(
      patientRecordAcknowledgmentRequestSchema.parse({
        patientId,
        expectedRowVersion: 1,
        status: 'DECLINED',
        note: null
      })
    ).toEqual({
      patientId,
      expectedRowVersion: 1,
      status: 'DECLINED',
      note: null
    })
  })

  it('validates acknowledgment results and history version metadata', () => {
    expect(
      patientRecordAcknowledgmentResultSchema.parse(
        createIpcSuccess({
          status: 'RECORDED',
          acknowledgmentId,
          patient: publicPatient
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'RECORDED',
        acknowledgmentId,
        patient: publicPatient
      })
    )
    expect(
      patientRecordAcknowledgmentResultSchema.parse(
        createIpcSuccess({
          status: 'DUPLICATE_DECISION',
          patient: publicPatient,
          acknowledgment: acknowledgmentRecord
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'DUPLICATE_DECISION',
        patient: publicPatient,
        acknowledgment: acknowledgmentRecord
      })
    )
    const historyResult = patientListAcknowledgmentHistoryResultSchema.parse(
      createIpcSuccess({
        items: [
          acknowledgmentRecord,
          {
            ...acknowledgmentRecord,
            acknowledgmentId: '55555555-5555-4555-8555-555555555555',
            status: 'NOT_REQUESTED',
            note: null,
            priorRowVersion: null,
            resultingRowVersion: null
          }
        ],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )

    expect(historyResult.ok).toBe(true)

    if (historyResult.ok) {
      expect(historyResult.data.items[1]!.status).toBe('NOT_REQUESTED')
    }

    for (const record of [
      { ...acknowledgmentRecord, priorRowVersion: null },
      { ...acknowledgmentRecord, resultingRowVersion: null },
      { ...acknowledgmentRecord, resultingRowVersion: 4 },
      { ...acknowledgmentRecord, consent_type: 'PATIENT_REGISTRY_ACKNOWLEDGMENT' },
      { ...acknowledgmentRecord, source_type: 'LOCAL' },
      { ...acknowledgmentRecord, tableName: 'consent_records' },
      { ...acknowledgmentRecord, recorded_by: actorId },
      { ...acknowledgmentRecord, extra: true }
    ]) {
      expect(publicPatientAcknowledgmentHistoryRecordSchema.safeParse(record).success).toBe(false)
    }
  })

  it('keeps legacy patient.update unchanged during E1', () => {
    const legacyUpdate = {
      patientId,
      expectedRowVersion: 1,
      patch: {
        givenName: 'Test',
        familyName: 'Patient',
        otherNames: null,
        dateOfBirth: '1990-01-01',
        approximateAgeYears: null,
        ageAsOfDate: null,
        sex: 'FEMALE',
        village: 'Test Buea',
        quarter: null,
        phone: null,
        alternateContactName: null,
        alternateContactPhone: null,
        residenceNotes: null,
        status: 'ACTIVE',
        acknowledgmentStatus: 'ACKNOWLEDGED'
      }
    } as const

    expect(patientUpdateRequestSchema.parse(legacyUpdate)).toEqual(legacyUpdate)
    expect(
      patientUpdateRequestSchema.safeParse({
        ...legacyUpdate,
        patch: { ...legacyUpdate.patch, patientCode: 'PT-000001' }
      }).success
    ).toBe(false)
  })
})
