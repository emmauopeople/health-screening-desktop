import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createFirstRunFailure,
  createIpcSuccess,
  createPatientFailure,
  ipcChannels,
  type AppHealth,
  type AppInfo,
  type FirstRunInitializeRequest,
  type PatientAmendDemographicsRequest,
  type PatientListAcknowledgmentHistoryRequest,
  type PatientListDemographicAmendmentHistoryRequest,
  type PatientRecordAcknowledgmentRequest,
  type PublicPatientAcknowledgmentHistoryRecord,
  type PublicPatientDemographicAmendmentRecord,
  type PublicPatientDetail
} from '@shared/ipc'

const validInfo: AppInfo = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  platform: 'win32',
  architecture: 'x64',
  packaged: false
}

const validHealth: AppHealth = {
  status: 'ready',
  ipc: 'available',
  database: 'ready',
  clinicalFeatures: 'not-implemented'
}

const patientId = '11111111-1111-4111-8111-111111111111'
const actorId = '22222222-2222-4222-8222-222222222222'
const amendmentId = '33333333-3333-4333-8333-333333333333'
const acknowledgmentId = '44444444-4444-4444-8444-444444444444'
const timestamp = '2026-07-29T12:34:56.789Z'
const sensitiveReasonNote = 'corrected synthetic reason note'
const sensitiveAcknowledgmentNote = 'synthetic acknowledgment note'

const publicPatient: PublicPatientDetail = {
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
}

const amendDemographicsRequest: PatientAmendDemographicsRequest = {
  patientId,
  expectedRowVersion: 1,
  reasonCode: 'DATA_ENTRY_CORRECTION',
  reasonNote: sensitiveReasonNote,
  patch: {
    givenName: 'Test'
  }
}

const demographicHistoryRequest: PatientListDemographicAmendmentHistoryRequest = {
  patientId,
  page: 1,
  pageSize: 25
}

const recordAcknowledgmentRequest: PatientRecordAcknowledgmentRequest = {
  patientId,
  expectedRowVersion: 1,
  status: 'ACKNOWLEDGED',
  note: sensitiveAcknowledgmentNote
}

const acknowledgmentHistoryRequest: PatientListAcknowledgmentHistoryRequest = {
  patientId,
  page: 1,
  pageSize: 25
}

const validFirstRunRequest: FirstRunInitializeRequest = {
  deploymentName: 'Cameroon Pilot',
  timeZone: 'Africa/Douala',
  administrator: {
    username: 'Admin.User',
    displayName: 'Admin User',
    temporaryPassword: 'ValidPassw0rd!'
  },
  initialLocation: {
    name: 'Central Church',
    locationType: 'CHURCH',
    village: 'Messa',
    subdivision: 'Yaounde I',
    region: 'Centre',
    directions: 'Opposite market gate.'
  }
}

describe('preload API factory', () => {
  it('exposes only the fixed app and first-run methods as frozen groups', () => {
    const api = createHealthScreeningApi(vi.fn())

    expect(Object.keys(api)).toEqual(['app', 'firstRun', 'auth', 'patient'])
    expect(Object.keys(api.app)).toEqual(['getInfo', 'getHealth'])
    expect(Object.keys(api.firstRun)).toEqual(['getState', 'initialize'])
    expect(Object.keys(api.auth)).toEqual([
      'getSession',
      'login',
      'changeRequiredPassword',
      'unlock',
      'lock',
      'logout',
      'recordActivity',
      'onSessionChanged'
    ])
    expect(Object.keys(api.patient)).toEqual([
      'search',
      'get',
      'create',
      'amendDemographics',
      'listDemographicAmendmentHistory',
      'recordAcknowledgment',
      'listAcknowledgmentHistory',
      'listRecent',
      'findDuplicates',
      'markNotDuplicate'
    ])
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.app)).toBe(true)
    expect(Object.isFrozen(api.firstRun)).toBe(true)
    expect(Object.isFrozen(api.auth)).toBe(true)
    expect(Object.isFrozen(api.patient)).toBe(true)
    expect('invoke' in api).toBe(false)
    expect('send' in api).toBe(false)
    expect('on' in api).toBe(false)
    expect('once' in api).toBe(false)
    expect('removeListener' in api).toBe(false)
    expect('ipcRenderer' in api).toBe(false)
    expect('channel' in api.firstRun).toBe(false)
    expect('channel' in api.auth).toBe(false)
    expect('channel' in api.patient).toBe(false)
  })

  it('invokes patient.search over the exact fixed channel with a parsed request', async () => {
    const searchResult = {
      items: [],
      page: 1,
      pageSize: 25 as const,
      total: 0
    }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(searchResult))
    const api = createHealthScreeningApi(invoke)

    await expect(api.patient.search({ query: 'Ada', page: 1, pageSize: 25 })).resolves.toEqual(
      createIpcSuccess(searchResult)
    )
    expect(invoke).toHaveBeenCalledWith(ipcChannels.patient.search, {
      query: 'Ada',
      page: 1,
      pageSize: 25
    })
  })

  it('returns VALIDATION_FAILED for invalid local patient input without invoking IPC', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke)

    await expect(api.patient.search({ query: 'Ada', page: 0, pageSize: 25 })).resolves.toEqual(
      createPatientFailure('VALIDATION_FAILED')
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('exposes patient amendment and acknowledgment methods without transport internals', () => {
    const api = createHealthScreeningApi(vi.fn())

    for (const method of [
      'amendDemographics',
      'listDemographicAmendmentHistory',
      'recordAcknowledgment',
      'listAcknowledgmentHistory'
    ]) {
      expect(method in api.patient).toBe(true)
    }

    for (const transportName of [
      'invoke',
      'send',
      'on',
      'once',
      'removeListener',
      'ipcRenderer',
      'channel'
    ]) {
      expect(transportName in api.patient).toBe(false)
    }

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.patient)).toBe(true)
  })

  it('invokes patient.amendDemographics over the exact fixed channel with parsed requests', async () => {
    const amended = createIpcSuccess({
      status: 'AMENDED' as const,
      amendmentId,
      patient: publicPatient
    })
    const conflict = createIpcSuccess({
      status: 'PATIENT_VERSION_CONFLICT' as const,
      patient: publicPatient
    })
    const safeFailure = createPatientFailure('AUTH_LOCKED')
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(amended)
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(safeFailure)
    const api = createHealthScreeningApi(invoke)
    const request: PatientAmendDemographicsRequest = {
      ...amendDemographicsRequest,
      patch: { ...amendDemographicsRequest.patch }
    }

    await expect(api.patient.amendDemographics(request)).resolves.toEqual(amended)
    await expect(api.patient.amendDemographics(amendDemographicsRequest)).resolves.toEqual(conflict)
    await expect(api.patient.amendDemographics(amendDemographicsRequest)).resolves.toEqual(
      safeFailure
    )
    expect(invoke).toHaveBeenNthCalledWith(1, ipcChannels.patient.amendDemographics, {
      ...amendDemographicsRequest
    })
    expect(invoke.mock.calls[0]?.[1]).not.toBe(request)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', expect.anything())
  })

  it('rejects invalid patient.amendDemographics requests locally and maps unsafe responses', async () => {
    const invalidInvoke = vi.fn()
    const malformedInvoke = vi.fn().mockResolvedValue(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: { ...publicPatient, internalPatientId: patientId }
      })
    )
    const rejectedInvoke = vi.fn().mockRejectedValue(createSensitiveError())

    await expect(
      createHealthScreeningApi(invalidInvoke).patient.amendDemographics({
        ...amendDemographicsRequest,
        channel: 'attacker:channel'
      } as unknown as PatientAmendDemographicsRequest)
    ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
    expect(invalidInvoke).not.toHaveBeenCalled()
    await expect(
      createHealthScreeningApi(malformedInvoke).patient.amendDemographics(amendDemographicsRequest)
    ).resolves.toEqual(createPatientFailure('IPC_UNAVAILABLE'))

    const rejected =
      await createHealthScreeningApi(rejectedInvoke).patient.amendDemographics(
        amendDemographicsRequest
      )
    expect(rejected).toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    expectPatientFailureIsSafe(rejected)
  })

  it('invokes demographic amendment history with validated paging and fixed channels', async () => {
    for (const pageSize of [25, 50, 100] as const) {
      const result = createIpcSuccess({
        items: [createDemographicAmendmentRecord()],
        page: 1,
        pageSize,
        total: 1
      })
      const invoke = vi.fn().mockResolvedValue(result)
      const api = createHealthScreeningApi(invoke)
      const request = { ...demographicHistoryRequest, pageSize }

      await expect(api.patient.listDemographicAmendmentHistory(request)).resolves.toEqual(result)
      expect(invoke).toHaveBeenCalledWith(
        ipcChannels.patient.listDemographicAmendmentHistory,
        request
      )
    }
  })

  it('maps malformed demographic history responses to IPC_UNAVAILABLE', async () => {
    let accessorInvoked = false
    const unsafeChanges = [createDemographicAmendmentRecord().changes[0]]

    Object.defineProperty(unsafeChanges, '0', {
      enumerable: true,
      get() {
        accessorInvoked = true
        return createDemographicAmendmentRecord().changes[0]
      }
    })

    for (const response of [
      createIpcSuccess({
        items: [{ ...createDemographicAmendmentRecord(), changes: unsafeChanges }],
        page: 1,
        pageSize: 25,
        total: 1
      }),
      createIpcSuccess({
        items: [
          {
            ...createDemographicAmendmentRecord(),
            changes: [...createDemographicAmendmentRecord().changes].reverse()
          }
        ],
        page: 1,
        pageSize: 25,
        total: 1
      }),
      createIpcSuccess({
        items: [{ ...createDemographicAmendmentRecord(), amended_by: actorId }],
        page: 1,
        pageSize: 25,
        total: 1
      })
    ]) {
      await expect(
        createHealthScreeningApi(
          vi.fn().mockResolvedValue(response)
        ).patient.listDemographicAmendmentHistory(demographicHistoryRequest)
      ).resolves.toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    }

    await expect(
      createHealthScreeningApi(vi.fn()).patient.listDemographicAmendmentHistory({
        ...demographicHistoryRequest,
        pageSize: 10
      } as unknown as PatientListDemographicAmendmentHistoryRequest)
    ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
    expect(accessorInvoked).toBe(false)

    const rejected = await createHealthScreeningApi(
      vi.fn().mockRejectedValue(createSensitiveError())
    ).patient.listDemographicAmendmentHistory(demographicHistoryRequest)
    expect(rejected).toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    expectPatientFailureIsSafe(rejected)
  })

  it('invokes patient.recordAcknowledgment for explicit decisions and maps business results', async () => {
    const recorded = createIpcSuccess({
      status: 'RECORDED' as const,
      acknowledgmentId,
      patient: publicPatient
    })
    const conflict = createIpcSuccess({
      status: 'PATIENT_VERSION_CONFLICT' as const,
      patient: publicPatient
    })
    const duplicate = createIpcSuccess({
      status: 'DUPLICATE_DECISION' as const,
      patient: publicPatient,
      acknowledgment: createAcknowledgmentHistoryRecord()
    })
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(recorded)
      .mockResolvedValueOnce(conflict)
      .mockResolvedValueOnce(duplicate)
      .mockResolvedValueOnce(recorded)
    const api = createHealthScreeningApi(invoke)

    await expect(api.patient.recordAcknowledgment(recordAcknowledgmentRequest)).resolves.toEqual(
      recorded
    )
    await expect(
      api.patient.recordAcknowledgment({ ...recordAcknowledgmentRequest, status: 'DECLINED' })
    ).resolves.toEqual(conflict)
    await expect(api.patient.recordAcknowledgment(recordAcknowledgmentRequest)).resolves.toEqual(
      duplicate
    )
    await expect(
      api.patient.recordAcknowledgment({ ...recordAcknowledgmentRequest, status: 'DECLINED' })
    ).resolves.toEqual(recorded)
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      ipcChannels.patient.recordAcknowledgment,
      recordAcknowledgmentRequest
    )
    expect(invoke).toHaveBeenNthCalledWith(2, ipcChannels.patient.recordAcknowledgment, {
      ...recordAcknowledgmentRequest,
      status: 'DECLINED'
    })
  })

  it('rejects invalid acknowledgment commands locally and maps unsafe responses', async () => {
    const invalidInvoke = vi.fn()

    for (const request of [
      { ...recordAcknowledgmentRequest, status: 'NOT_REQUESTED' },
      { ...recordAcknowledgmentRequest, note: 'Unsafe\nnote' },
      { ...recordAcknowledgmentRequest, channel: 'attacker:channel' }
    ]) {
      await expect(
        createHealthScreeningApi(invalidInvoke).patient.recordAcknowledgment(
          request as unknown as PatientRecordAcknowledgmentRequest
        )
      ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))
    }

    expect(invalidInvoke).not.toHaveBeenCalled()

    await expect(
      createHealthScreeningApi(
        vi.fn().mockResolvedValue(
          createIpcSuccess({
            status: 'RECORDED',
            acknowledgmentId,
            patient: { ...publicPatient, consent_type: 'PATIENT_REGISTRY_ACKNOWLEDGMENT' }
          })
        )
      ).patient.recordAcknowledgment(recordAcknowledgmentRequest)
    ).resolves.toEqual(createPatientFailure('IPC_UNAVAILABLE'))

    const rejected = await createHealthScreeningApi(
      vi.fn().mockRejectedValue(createSensitiveError())
    ).patient.recordAcknowledgment(recordAcknowledgmentRequest)
    expect(rejected).toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    expectPatientFailureIsSafe(rejected)
  })

  it('validates acknowledgment history responses including legacy records', async () => {
    const explicitRecord = createAcknowledgmentHistoryRecord()
    const legacyRecord = createAcknowledgmentHistoryRecord({
      status: 'NOT_REQUESTED',
      note: null,
      priorRowVersion: null,
      resultingRowVersion: null
    })
    const result = createIpcSuccess({
      items: [explicitRecord, legacyRecord],
      page: 1,
      pageSize: 25 as const,
      total: 2
    })
    const invoke = vi.fn().mockResolvedValue(result)

    await expect(
      createHealthScreeningApi(invoke).patient.listAcknowledgmentHistory(
        acknowledgmentHistoryRequest
      )
    ).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith(
      ipcChannels.patient.listAcknowledgmentHistory,
      acknowledgmentHistoryRequest
    )
  })

  it('maps malformed acknowledgment history responses to IPC_UNAVAILABLE', async () => {
    const oversizedItems = Array.from({ length: 101 }, (_, index) =>
      createAcknowledgmentHistoryRecord({
        acknowledgmentId: `44444444-4444-4444-8444-${index.toString(16).padStart(12, '0')}`
      })
    )

    for (const response of [
      createIpcSuccess({
        items: [
          {
            ...createAcknowledgmentHistoryRecord(),
            priorRowVersion: null
          }
        ],
        page: 1,
        pageSize: 25,
        total: 1
      }),
      createIpcSuccess({
        items: [{ ...createAcknowledgmentHistoryRecord(), sourceType: 'REMOTE' }],
        page: 1,
        pageSize: 25,
        total: 1
      }),
      createIpcSuccess({
        items: [
          {
            ...createAcknowledgmentHistoryRecord(),
            consent_type: 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
          }
        ],
        page: 1,
        pageSize: 25,
        total: 1
      }),
      createIpcSuccess({
        items: oversizedItems,
        page: 1,
        pageSize: 100,
        total: 101
      })
    ]) {
      await expect(
        createHealthScreeningApi(
          vi.fn().mockResolvedValue(response)
        ).patient.listAcknowledgmentHistory(acknowledgmentHistoryRequest)
      ).resolves.toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    }

    await expect(
      createHealthScreeningApi(vi.fn()).patient.listAcknowledgmentHistory({
        ...acknowledgmentHistoryRequest,
        unknown: true
      } as unknown as PatientListAcknowledgmentHistoryRequest)
    ).resolves.toEqual(createPatientFailure('VALIDATION_FAILED'))

    const rejected = await createHealthScreeningApi(
      vi.fn().mockRejectedValue(createSensitiveError())
    ).patient.listAcknowledgmentHistory(acknowledgmentHistoryRequest)
    expect(rejected).toEqual(createPatientFailure('IPC_UNAVAILABLE'))
    expectPatientFailureIsSafe(rejected)
  })

  it('invokes app.getInfo over the exact fixed channel with an empty request', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validInfo))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual(createIpcSuccess(validInfo))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getInfo, {})
  })

  it('invokes app.getHealth over the exact fixed channel with an empty request', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validHealth))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getHealth()).resolves.toEqual(createIpcSuccess(validHealth))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getHealth, {})
  })

  it('ignores renderer-supplied arguments and never accepts a channel string', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validInfo))
    const api = createHealthScreeningApi(invoke)

    await api.app.getInfo()

    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', {})
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getInfo, {})
  })

  it('maps malformed envelopes to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...validInfo,
        userDataPath: 'C:\\secret'
      }
    })
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })

  it('maps malformed failure envelopes to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'C:\\secret\\raw error'
      }
    })
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })

  it('maps invoke rejection to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('raw electron error'))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getHealth()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })

  it('invokes firstRun.getState over the exact fixed channel with an empty request', async () => {
    const state = { status: 'REQUIRED' as const }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(state))
    const api = createHealthScreeningApi(invoke)

    await expect(api.firstRun.getState()).resolves.toEqual(createIpcSuccess(state))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.firstRun.getState, {})
  })

  it('invokes firstRun.initialize over the exact fixed channel with a parsed command', async () => {
    const initialized = {
      status: 'INITIALIZED' as const,
      deploymentName: 'Cameroon Pilot',
      timeZone: 'Africa/Douala'
    }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(initialized))
    const api = createHealthScreeningApi(invoke)

    await expect(api.firstRun.initialize(validFirstRunRequest)).resolves.toEqual(
      createIpcSuccess(initialized)
    )
    expect(invoke).toHaveBeenCalledWith(ipcChannels.firstRun.initialize, validFirstRunRequest)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', validFirstRunRequest)
  })

  it('returns VALIDATION_FAILED for invalid local first-run input without invoking IPC', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke)
    const descriptorTrapRequest = new Proxy(
      { ...validFirstRunRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(
      api.firstRun.initialize({
        ...validFirstRunRequest,
        initialLocation: { ...validFirstRunRequest.initialLocation, village: undefined }
      } as unknown as FirstRunInitializeRequest)
    ).resolves.toEqual(createFirstRunFailure('VALIDATION_FAILED'))
    await expect(
      api.firstRun.initialize(descriptorTrapRequest as unknown as FirstRunInitializeRequest)
    ).resolves.toEqual(createFirstRunFailure('VALIDATION_FAILED'))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('maps malformed first-run envelopes and invoke rejection to IPC_UNAVAILABLE', async () => {
    const malformedSuccessInvoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'INITIALIZED',
        deploymentName: 'Cameroon Pilot',
        timeZone: 'Africa/Douala',
        id: '11111111-1111-4111-8111-111111111111'
      }
    })
    const malformedFailureInvoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'FIRST_RUN_INITIALIZATION_FAILED',
        message: 'C:\\secret\\raw error'
      }
    })
    const rejectedInvoke = vi.fn().mockRejectedValue(new Error('raw electron error'))

    await expect(
      createHealthScreeningApi(malformedSuccessInvoke).firstRun.getState()
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    await expect(
      createHealthScreeningApi(malformedFailureInvoke).firstRun.initialize(validFirstRunRequest)
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    await expect(
      createHealthScreeningApi(rejectedInvoke).firstRun.initialize(validFirstRunRequest)
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
  })

  it('does not expose password or raw error values in serialized first-run failures', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('ValidPassw0rd! C:\\secret\\raw error'))
    const api = createHealthScreeningApi(invoke)
    const result = await api.firstRun.initialize(validFirstRunRequest)
    const serialized = JSON.stringify(result)

    expect(result).toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    expect(serialized).not.toContain('ValidPassw0rd')
    expect(serialized).not.toContain('raw error')
    expect(serialized).not.toContain('C:\\')
  })
})

function createDemographicAmendmentRecord(
  overrides: Partial<PublicPatientDemographicAmendmentRecord> = {}
): PublicPatientDemographicAmendmentRecord {
  return {
    amendmentId,
    patientId,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: sensitiveReasonNote,
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
        fieldName: 'status',
        previousValue: 'ACTIVE',
        newValue: 'INACTIVE'
      }
    ],
    ...overrides
  }
}

function createAcknowledgmentHistoryRecord(
  overrides: Partial<PublicPatientAcknowledgmentHistoryRecord> = {}
): PublicPatientAcknowledgmentHistoryRecord {
  return {
    acknowledgmentId,
    patientId,
    status: 'ACKNOWLEDGED',
    sourceType: 'LOCAL',
    note: sensitiveAcknowledgmentNote,
    recordedByUserId: actorId,
    recordedByDisplayName: 'Admin User',
    recordedAt: timestamp,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    ...overrides
  }
}

function createSensitiveError(): Error {
  const error = new Error(
    `SELECT * FROM patients WHERE id = ${patientId}; ${sensitiveReasonNote}; ${sensitiveAcknowledgmentNote}; C:\\secret\\patient.sqlite3`
  )
  error.name = 'SensitivePatientError'

  return error
}

function expectPatientFailureIsSafe(result: unknown): void {
  const serialized = JSON.stringify(result)

  expect(serialized).not.toContain(patientId)
  expect(serialized).not.toContain(sensitiveReasonNote)
  expect(serialized).not.toContain(sensitiveAcknowledgmentNote)
  expect(serialized).not.toContain('SELECT')
  expect(serialized).not.toContain('patients')
  expect(serialized).not.toContain('C:\\')
  expect(serialized).not.toContain('SensitivePatientError')
  expect(serialized).not.toContain('stack')
}
