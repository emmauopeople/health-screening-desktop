import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createIpcSuccess,
  createScreeningVitalsGetDraftLoadedResult,
  createScreeningEncounterIpcFailure,
  ipcChannels,
  type PublicScreeningEncounterStartSummary,
  type PublicScreeningVitalsDraft,
  type ScreeningEncounterCompleteRequest,
  type ScreeningEncounterStartRequest,
  type ScreeningVitalsSaveDraftRequest
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const screeningSessionId = '22222222-2222-4222-8222-222222222222'
const encounterId = '33333333-3333-4333-8333-333333333333'
const vitalsDraftId = '44444444-4444-4444-8444-444444444444'
const vitalsReadingId = '55555555-5555-4555-8555-555555555555'
const startedAt = '2026-08-06T12:00:00.000Z'
const sensitiveValue = 'Sensitive Patient C:\\secret\\screening.sqlite SELECT'

const request: ScreeningEncounterStartRequest = {
  patientId,
  screeningSessionId
}

const encounter: PublicScreeningEncounterStartSummary = {
  id: encounterId,
  patientId,
  screeningSessionId,
  status: 'DRAFT',
  startedAt,
  recordVersion: 1
}
const vitalsDraft: PublicScreeningVitalsDraft = {
  id: vitalsDraftId,
  encounterId,
  status: 'DRAFT',
  readings: [
    {
      id: vitalsReadingId,
      sequenceNumber: 1,
      systolic: 120,
      diastolic: null,
      pulse: null,
      measurementSite: 'RIGHT_ARM',
      patientPosition: null,
      measurementTime: null
    }
  ],
  weightKg: null,
  waistCm: null,
  notes: null,
  rowVersion: 1,
  updatedAt: startedAt
}
const vitalsSaveRequest: ScreeningVitalsSaveDraftRequest = {
  encounterId,
  expectedVersion: null,
  readings: [
    {
      id: null,
      sequenceNumber: 1,
      systolic: 120,
      diastolic: null,
      pulse: null,
      measurementSite: 'RIGHT_ARM',
      patientPosition: null,
      measurementTime: null
    }
  ],
  weightKg: null,
  waistCm: null,
  notes: null
}
const completeRequest: ScreeningEncounterCompleteRequest = {
  encounterId,
  expectedEncounterVersion: 1,
  expectedVitalsVersion: 2,
  expectedLifestyleVersion: 3,
  expectedFoodVersion: 4,
  expectedOtcVersion: 5,
  reviewConfirmed: true,
  alcoholBaselineReviewConfirmedVersionId: null,
  tobaccoBaselineReviewConfirmedVersionId: null
}

describe('preload screening-encounter API', () => {
  it('exposes exactly the frozen screeningEncounters methods', () => {
    const api = createHealthScreeningApi(vi.fn())

    expect(Object.keys(api.screeningEncounters)).toEqual([
      'start',
      'complete',
      'management',
      'vitals',
      'lifestyle',
      'food',
      'otc'
    ])
    expect(Object.keys(api.screeningEncounters.vitals)).toEqual([
      'getDraft',
      'saveDraft',
      'completeStep'
    ])
    expect(Object.keys(api.screeningEncounters.management)).toEqual([
      'search',
      'getDetail',
      'addAddendum',
      'openFlag',
      'resolveFlag',
      'voidEmptyDraft'
    ])
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters.management)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters.vitals)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters.lifestyle)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters.food)).toBe(true)
    expect(Object.isFrozen(api.screeningEncounters.otc)).toBe(true)

    for (const transportName of [
      'invoke',
      'send',
      'sendSync',
      'on',
      'once',
      'removeListener',
      'subscribe',
      'ipcRenderer',
      'channel'
    ]) {
      expect(transportName in api.screeningEncounters).toBe(false)
      expect(transportName in api.screeningEncounters.vitals).toBe(false)
      expect(transportName in api.screeningEncounters.food).toBe(false)
      expect(transportName in api.screeningEncounters.otc).toBe(false)
    }
  })

  it('invokes only the fixed start channel with the parsed request', async () => {
    const response = createIpcSuccess({ status: 'STARTED' as const, encounter })
    const invoke = vi.fn().mockResolvedValue(response)
    const api = createHealthScreeningApi(invoke)
    const rendererRequest = { ...request }

    await expect(api.screeningEncounters.start(rendererRequest)).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith(ipcChannels.screeningEncounters.start, request)
    expect(invoke.mock.calls[0]?.[1]).not.toBe(rendererRequest)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', expect.anything())
    expect(rendererRequest).toEqual(request)
    expect(Object.isFrozen(rendererRequest)).toBe(false)
  })

  it('invokes the fixed empty-draft void channel with a strict versioned request', async () => {
    const response = createIpcSuccess({ status: 'VOIDED' as const, recordVersion: 2 })
    const invoke = vi.fn().mockResolvedValue(response)
    const api = createHealthScreeningApi(invoke)
    const request = {
      encounterId,
      expectedVersion: 1,
      reason: 'Created without screening data.'
    }

    await expect(api.screeningEncounters.management.voidEmptyDraft(request)).resolves.toEqual(
      response
    )
    expect(invoke).toHaveBeenCalledWith(
      ipcChannels.screeningEncounters.management.voidEmptyDraft,
      request
    )
  })

  it('invokes completion only after local strict validation', async () => {
    const response = createIpcSuccess({
      status: 'COMPLETED' as const,
      encounter: {
        ...encounter,
        status: 'COMPLETED' as const,
        completedAt: startedAt,
        recordVersion: 2
      }
    })
    const invoke = vi.fn().mockResolvedValue(response)
    const api = createHealthScreeningApi(invoke)

    await expect(api.screeningEncounters.complete(completeRequest)).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith(ipcChannels.screeningEncounters.complete, completeRequest)

    const invalidResult = await api.screeningEncounters.complete({
      ...completeRequest,
      reviewConfirmed: false
    } as unknown as ScreeningEncounterCompleteRequest)
    expect(invalidResult).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('rejects invalid and authority-bearing requests locally without IPC invocation', async () => {
    for (const invalidRequest of [
      {},
      { patientId },
      { patientId: 'bad-id', screeningSessionId },
      { ...request, actor: { userId: patientId, role: 'LOCAL_ADMIN' } },
      { ...request, userId: patientId },
      { ...request, role: 'NURSE' },
      { ...request, locationId: patientId },
      { ...request, encounterId },
      { ...request, protocolVersionId: patientId },
      { ...request, status: 'DRAFT' },
      { ...request, sessionDate: '2026-08-06' },
      { ...request, startedAt },
      { ...request, recordVersion: 1 },
      { ...request, systolic: 120 },
      { ...request, recommendation: 'refer' },
      { ...request, referralId: patientId }
    ]) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningEncounters.start(
        invalidRequest as ScreeningEncounterStartRequest
      )

      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      expect(Object.isFrozen(result)).toBe(true)
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('contains hostile renderer request objects without invoking IPC or accessors', async () => {
    let getterInvoked = false
    const accessorRequest = { ...request }

    Object.defineProperty(accessorRequest, 'patientId', {
      enumerable: true,
      get() {
        getterInvoked = true
        return patientId
      }
    })

    const symbolRequest = Object.defineProperty({ ...request }, Symbol('role'), {
      enumerable: true,
      value: 'LOCAL_ADMIN'
    })
    const cyclicRequest: Record<string, unknown> = { ...request }
    cyclicRequest['self'] = cyclicRequest
    const customPrototypeRequest = Object.assign(Object.create({ trusted: true }), request)
    const proxyTrapRequest = new Proxy(
      { ...request },
      {
        getOwnPropertyDescriptor() {
          throw new Error(sensitiveValue)
        }
      }
    )

    for (const unsafeRequest of [
      accessorRequest,
      symbolRequest,
      cyclicRequest,
      customPrototypeRequest,
      proxyTrapRequest
    ]) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningEncounters.start(
        unsafeRequest as ScreeningEncounterStartRequest
      )

      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      expect(invoke).not.toHaveBeenCalled()
      expect(JSON.stringify(result)).not.toContain('C:\\')
      expect(JSON.stringify(result)).not.toContain('Sensitive Patient')
    }

    expect(getterInvoked).toBe(false)
  })

  it('preserves every valid HSD-029A outcome after response validation', async () => {
    const responses = [
      createIpcSuccess({ status: 'STARTED' as const, encounter }),
      createIpcSuccess({ status: 'ALREADY_EXISTS' as const, encounter }),
      createIpcSuccess({ status: 'PATIENT_NOT_FOUND' as const }),
      createIpcSuccess({ status: 'PATIENT_INELIGIBLE' as const }),
      createIpcSuccess({ status: 'SESSION_NOT_FOUND' as const }),
      createIpcSuccess({ status: 'SESSION_CLOSED' as const }),
      createIpcSuccess({ status: 'SESSION_NOT_CURRENT' as const }),
      createIpcSuccess({ status: 'LOCATION_NOT_FOUND' as const }),
      createIpcSuccess({ status: 'LOCATION_INACTIVE' as const }),
      createIpcSuccess({ status: 'FORBIDDEN' as const }),
      createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      createIpcSuccess({ status: 'AUTHENTICATION_REQUIRED' as const }),
      createIpcSuccess({ status: 'UNAVAILABLE' as const }),
      createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
    ]

    for (const response of responses) {
      await expect(
        createHealthScreeningApi(vi.fn().mockResolvedValue(response)).screeningEncounters.start(
          request
        )
      ).resolves.toEqual(response)
    }
  })

  it('maps invoke failures and malformed responses to frozen UNAVAILABLE results', async () => {
    const malformedResponses = [
      createIpcSuccess({
        status: 'STARTED',
        encounter: { ...encounter, recordedBy: patientId }
      }),
      createIpcSuccess({ status: 'UNKNOWN' }),
      {
        ok: false,
        error: {
          code: 'IPC_FORBIDDEN',
          message: sensitiveValue
        }
      },
      new Proxy(createIpcSuccess({ status: 'STARTED', encounter }), {
        ownKeys() {
          throw new Error(sensitiveValue)
        }
      })
    ]

    for (const response of malformedResponses) {
      const result = await createHealthScreeningApi(
        vi.fn().mockResolvedValue(response)
      ).screeningEncounters.start(request)

      expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      expect(Object.isFrozen(result)).toBe(true)
      expectFailureIsSafe(result)
    }

    for (const invoke of [
      vi.fn().mockRejectedValue(new Error(sensitiveValue)),
      vi.fn(() => {
        throw `primitive ${sensitiveValue}`
      })
    ]) {
      const result = await createHealthScreeningApi(invoke).screeningEncounters.start(request)

      expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      expect(Object.isFrozen(result)).toBe(true)
      expectFailureIsSafe(result)
    }
  })

  it('deeply freezes successful nested encounter results', async () => {
    const result = await createHealthScreeningApi(
      vi.fn().mockResolvedValue(createIpcSuccess({ status: 'STARTED', encounter }))
    ).screeningEncounters.start(request)

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.ok && result.data)).toBe(true)
    expect(Object.isFrozen(result.ok && 'encounter' in result.data && result.data.encounter)).toBe(
      true
    )
  })

  it('invokes only the fixed Vitals channels with parsed requests', async () => {
    const getResponse = createScreeningVitalsGetDraftLoadedResult(vitalsDraft)
    const saveResponse = createIpcSuccess({ status: 'SAVED' as const, draft: vitalsDraft })
    const completeResponse = createIpcSuccess({
      status: 'COMPLETED' as const,
      draft: { ...vitalsDraft, status: 'VITALS_COMPLETE' as const }
    })
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(getResponse)
      .mockResolvedValueOnce(saveResponse)
      .mockResolvedValueOnce(completeResponse)
    const api = createHealthScreeningApi(invoke)

    await expect(api.screeningEncounters.vitals.getDraft({ encounterId })).resolves.toEqual(
      getResponse
    )
    await expect(api.screeningEncounters.vitals.saveDraft(vitalsSaveRequest)).resolves.toEqual(
      saveResponse
    )
    await expect(api.screeningEncounters.vitals.completeStep(vitalsSaveRequest)).resolves.toEqual(
      completeResponse
    )

    expect(invoke).toHaveBeenNthCalledWith(1, ipcChannels.screeningEncounters.getVitalsDraft, {
      encounterId
    })
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      ipcChannels.screeningEncounters.saveVitalsDraft,
      vitalsSaveRequest
    )
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      ipcChannels.screeningEncounters.completeVitalsStep,
      vitalsSaveRequest
    )
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', expect.anything())
  })

  it('rejects invalid and authority-bearing Vitals requests locally without IPC invocation', async () => {
    for (const invalidGetRequest of [
      {},
      { encounterId: 'bad-id' },
      { encounterId, actor: { userId: patientId } },
      { encounterId, role: 'NURSE' },
      { encounterId, patientId },
      { encounterId, screeningSessionId },
      { encounterId, locationId: patientId }
    ]) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningEncounters.vitals.getDraft(
        invalidGetRequest as never
      )

      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      expect(invoke).not.toHaveBeenCalled()
    }

    for (const invalidSaveRequest of [
      {},
      { encounterId },
      { ...vitalsSaveRequest, readings: [] },
      { ...vitalsSaveRequest, expectedVersion: 0 },
      { ...vitalsSaveRequest, readings: [{ ...vitalsSaveRequest.readings[0], pulse: 0 }] },
      {
        ...vitalsSaveRequest,
        readings: [{ ...vitalsSaveRequest.readings[0], measurementSite: 'ARM' }]
      },
      {
        ...vitalsSaveRequest,
        readings: [{ ...vitalsSaveRequest.readings[0], measurementTime: '25:00' }]
      },
      { ...vitalsSaveRequest, patientId },
      { ...vitalsSaveRequest, screeningSessionId },
      { ...vitalsSaveRequest, locationId: patientId },
      { ...vitalsSaveRequest, installationId: patientId },
      { ...vitalsSaveRequest, actor: { userId: patientId } },
      { ...vitalsSaveRequest, role: 'LOCAL_ADMIN' },
      { ...vitalsSaveRequest, force: true },
      { ...vitalsSaveRequest, bypass: true },
      { ...vitalsSaveRequest, complete: true }
    ]) {
      const invoke = vi.fn()
      const result = await createHealthScreeningApi(invoke).screeningEncounters.vitals.saveDraft(
        invalidSaveRequest as never
      )

      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      expect(Object.isFrozen(result)).toBe(true)
      expect(invoke).not.toHaveBeenCalled()
    }
  })

  it('maps Vitals invoke failures and malformed responses to frozen UNAVAILABLE results', async () => {
    const malformedResponses = [
      createIpcSuccess({
        status: 'SAVED',
        draft: { ...vitalsDraft, rowVersion: 0 }
      }),
      createIpcSuccess({ status: 'UNKNOWN' }),
      {
        ok: false,
        error: {
          code: 'IPC_FORBIDDEN',
          message: sensitiveValue
        }
      },
      new Proxy(createIpcSuccess({ status: 'SAVED', draft: vitalsDraft }), {
        ownKeys() {
          throw new Error(sensitiveValue)
        }
      })
    ]

    for (const response of malformedResponses) {
      const result = await createHealthScreeningApi(
        vi.fn().mockResolvedValue(response)
      ).screeningEncounters.vitals.saveDraft(vitalsSaveRequest)

      expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      expect(Object.isFrozen(result)).toBe(true)
      expectFailureIsSafe(result)
    }

    const thrown = await createHealthScreeningApi(
      vi.fn().mockRejectedValue(new Error(sensitiveValue))
    ).screeningEncounters.vitals.completeStep(vitalsSaveRequest)

    expect(thrown).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
    expect(Object.isFrozen(thrown)).toBe(true)
    expectFailureIsSafe(thrown)
  })
})

function expectFailureIsSafe(result: unknown): void {
  const serialized = JSON.stringify(result)

  expect(serialized).not.toContain(patientId)
  expect(serialized).not.toContain(screeningSessionId)
  expect(serialized).not.toContain('Sensitive Patient')
  expect(serialized).not.toContain('SELECT')
  expect(serialized).not.toContain('screening.sqlite')
  expect(serialized).not.toContain('C:\\')
}
