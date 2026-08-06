import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  ipcChannels,
  patientAmendDemographicsRequestSchema,
  patientAmendDemographicsResultSchema,
  patientAcknowledgmentDecisionStatusSchema,
  patientListAcknowledgmentHistoryRequestSchema,
  patientListAcknowledgmentHistoryResultSchema,
  patientListDemographicAmendmentHistoryRequestSchema,
  patientListDemographicAmendmentHistoryResultSchema,
  patientRecordAcknowledgmentRequestSchema,
  patientRecordAcknowledgmentResultSchema,
  patientCreateRequestSchema,
  type PublicPatientAcknowledgmentHistoryRecord,
  publicPatientAcknowledgmentHistoryRecordSchema,
  publicPatientDemographicAmendmentRecordSchema
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const amendmentId = '33333333-3333-4333-8333-333333333333'
const acknowledgmentId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-07-29T12:34:56.789Z'
const arrayProxyErrorText = 'array proxy leaked C:\\secret\\patient.sqlite3'

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
    const astral500 = '\u{1f600}'.repeat(500)
    const astral501 = '\u{1f600}'.repeat(501)

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
    expect(
      patientAmendDemographicsRequestSchema.safeParse({
        ...demographicRequest,
        reasonNote: astral500
      }).success
    ).toBe(true)
    expect(
      patientRecordAcknowledgmentRequestSchema.safeParse({
        patientId,
        expectedRowVersion: 1,
        status: 'ACKNOWLEDGED',
        note: astral500
      }).success
    ).toBe(true)

    for (const note of ['a'.repeat(501), astral501, 'Unsafe\nnote', 'Unsafe\uD800note']) {
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

  it('validates list-history requests strictly', () => {
    const request = { patientId, page: 1, pageSize: 25 } as const

    expect(patientListDemographicAmendmentHistoryRequestSchema.parse(request)).toEqual(request)
    expect(patientListAcknowledgmentHistoryRequestSchema.parse(request)).toEqual(request)

    for (const value of [
      { page: 1, pageSize: 25 },
      { patientId, page: 1 },
      { patientId, page: 1, pageSize: 25, extra: true }
    ]) {
      expect(patientListDemographicAmendmentHistoryRequestSchema.safeParse(value).success).toBe(
        false
      )
      expect(patientListAcknowledgmentHistoryRequestSchema.safeParse(value).success).toBe(false)
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

  it('bounds transport array work for patient history result arrays', () => {
    const maximumItems = Array.from({ length: 100 }, (_, index) =>
      createAcknowledgmentHistoryRecord(index)
    )
    const tooManyItems = Array.from({ length: 101 }, (_, index) =>
      createAcknowledgmentHistoryRecord(index)
    )
    const hugeSparseItems = new Array(1_000_000_000)
    const hugeSparseProxyItems = new Proxy(new Array(1_000_000_000), {
      get() {
        throw new Error(arrayProxyErrorText)
      }
    })

    expect(
      patientListAcknowledgmentHistoryResultSchema.safeParse(
        createIpcSuccess({
          items: maximumItems,
          page: 1,
          pageSize: 100,
          total: 100
        })
      ).success
    ).toBe(true)

    expectSafeParseFailure(
      patientListAcknowledgmentHistoryResultSchema,
      createIpcSuccess({
        items: tooManyItems,
        page: 1,
        pageSize: 100,
        total: 101
      })
    )
    expectSafeParseFailure(
      patientListAcknowledgmentHistoryResultSchema,
      createIpcSuccess({
        items: hugeSparseItems,
        page: 1,
        pageSize: 100,
        total: 0
      })
    )
    expectSafeParseFailure(
      patientListAcknowledgmentHistoryResultSchema,
      createIpcSuccess({
        items: hugeSparseProxyItems,
        page: 1,
        pageSize: 100,
        total: 0
      })
    )
  })

  it('rejects unsafe arrays in new history results without invoking accessors', () => {
    let itemsAccessorInvoked = false
    let changesAccessorInvoked = false
    const itemsWithAccessor = [acknowledgmentRecord]

    Object.defineProperty(itemsWithAccessor, '0', {
      enumerable: true,
      get() {
        itemsAccessorInvoked = true
        return acknowledgmentRecord
      }
    })

    const changesWithAccessor: unknown[] = [...demographicRecord.changes]

    Object.defineProperty(changesWithAccessor, '0', {
      enumerable: true,
      get() {
        changesAccessorInvoked = true
        return demographicRecord.changes[0]
      }
    })

    const customPrototypeItems = [acknowledgmentRecord]
    Object.setPrototypeOf(customPrototypeItems, { custom: true })

    const symbolItems = [acknowledgmentRecord]
    Object.defineProperty(symbolItems, Symbol('secret'), {
      enumerable: true,
      value: true
    })

    const namedPropertyItems = [acknowledgmentRecord]
    Object.defineProperty(namedPropertyItems, 'extra', {
      enumerable: true,
      value: true
    })

    const sparseItems = new Array(1)
    const getPrototypeThrowingItems = new Proxy([acknowledgmentRecord], {
      getPrototypeOf() {
        throw new Error(arrayProxyErrorText)
      }
    })
    const ownKeysThrowingItems = new Proxy([acknowledgmentRecord], {
      ownKeys() {
        throw new Error(arrayProxyErrorText)
      }
    })
    const descriptorThrowingItems = new Proxy([acknowledgmentRecord], {
      getOwnPropertyDescriptor() {
        throw new Error(arrayProxyErrorText)
      }
    })
    const revoked = Proxy.revocable([acknowledgmentRecord], {})
    revoked.revoke()

    expect(
      patientListAcknowledgmentHistoryResultSchema.safeParse(
        createIpcSuccess({
          items: [acknowledgmentRecord],
          page: 1,
          pageSize: 25,
          total: 1
        })
      ).success
    ).toBe(true)
    expect(
      patientListDemographicAmendmentHistoryResultSchema.safeParse(
        createIpcSuccess({
          items: [demographicRecord],
          page: 1,
          pageSize: 25,
          total: 1
        })
      ).success
    ).toBe(true)

    for (const items of [
      itemsWithAccessor,
      customPrototypeItems,
      symbolItems,
      namedPropertyItems,
      sparseItems,
      getPrototypeThrowingItems,
      ownKeysThrowingItems,
      descriptorThrowingItems,
      revoked.proxy
    ]) {
      expectSafeParseFailure(
        patientListAcknowledgmentHistoryResultSchema,
        createIpcSuccess({
          items,
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    }

    expectSafeParseFailure(
      patientListDemographicAmendmentHistoryResultSchema,
      createIpcSuccess({
        items: [{ ...demographicRecord, changes: changesWithAccessor }],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    expect(itemsAccessorInvoked).toBe(false)
    expect(changesAccessorInvoked).toBe(false)
  })

  it('keeps registration requests demographic-only', () => {
    const registrationRequest = {
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
      duplicateReviewToken: null
    } as const

    expect(patientCreateRequestSchema.parse(registrationRequest)).toEqual(registrationRequest)
    expect(
      patientCreateRequestSchema.safeParse({
        ...registrationRequest,
        patientCode: 'PT-000001'
      }).success
    ).toBe(false)
  })
})

interface SafeParseSchema {
  safeParse(value: unknown): { readonly success: boolean }
}

function expectSafeParseFailure(schema: SafeParseSchema, value: unknown): void {
  let result: { readonly success: boolean } | undefined

  expect(() => {
    result = schema.safeParse(value)
  }).not.toThrow()
  expect(result?.success).toBe(false)
  expect(JSON.stringify(result)).not.toContain(arrayProxyErrorText)
}

function createAcknowledgmentHistoryRecord(
  index: number
): PublicPatientAcknowledgmentHistoryRecord {
  return {
    ...acknowledgmentRecord,
    acknowledgmentId: `44444444-4444-4444-8444-${index.toString(16).padStart(12, '0')}`
  }
}
