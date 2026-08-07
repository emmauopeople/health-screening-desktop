import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  ipcChannels,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  screeningEncounterStartSuccessDataSchema,
  type PublicScreeningEncounterStartSummary,
  type ScreeningEncounterStartRequest
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const screeningSessionId = '22222222-2222-4222-8222-222222222222'
const encounterId = '33333333-3333-4333-8333-333333333333'
const startedAt = '2026-08-06T12:00:00.000Z'

const validRequest: ScreeningEncounterStartRequest = {
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

describe('screening encounter IPC contracts', () => {
  it('defines the fixed start channel', () => {
    expect(ipcChannels.screeningEncounters.start).toBe(
      'health-screening:screening-encounters:start'
    )
  })

  it('accepts exactly the patient and screening-session IDs', () => {
    expect(screeningEncounterStartRequestSchema.parse(validRequest)).toEqual(validRequest)
  })

  it('rejects missing, malformed, authority-bearing, and clinical request fields', () => {
    for (const request of [
      {},
      { patientId },
      { screeningSessionId },
      { patientId: 'not-a-uuid', screeningSessionId },
      { patientId, screeningSessionId: 'not-a-uuid' },
      { ...validRequest, actor: { userId: patientId, role: 'LOCAL_ADMIN' } },
      { ...validRequest, userId: patientId },
      { ...validRequest, role: 'NURSE' },
      { ...validRequest, locationId: patientId },
      { ...validRequest, encounterId },
      { ...validRequest, protocolVersionId: patientId },
      { ...validRequest, status: 'DRAFT' },
      { ...validRequest, sessionDate: '2026-08-06' },
      { ...validRequest, startedAt },
      { ...validRequest, recordVersion: 1 },
      { ...validRequest, audit: {} },
      { ...validRequest, outbox: {} },
      { ...validRequest, systolic: 120 },
      { ...validRequest, recommendation: 'refer' },
      { ...validRequest, referralId: patientId }
    ]) {
      expect(screeningEncounterStartRequestSchema.safeParse(request).success).toBe(false)
    }
  })

  it('rejects hostile transport request objects without invoking accessors', () => {
    let getterInvoked = false
    const accessorRequest = { ...validRequest }

    Object.defineProperty(accessorRequest, 'patientId', {
      enumerable: true,
      get() {
        getterInvoked = true
        return patientId
      }
    })

    const symbolRequest = Object.defineProperty({ ...validRequest }, Symbol('role'), {
      enumerable: true,
      value: 'LOCAL_ADMIN'
    })
    const cyclicRequest: Record<string, unknown> = { ...validRequest }
    cyclicRequest['self'] = cyclicRequest
    const customPrototypeRequest = Object.assign(Object.create({ trusted: true }), validRequest)
    const proxyTrapRequest = new Proxy(
      { ...validRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\request.txt')
        }
      }
    )

    for (const request of [
      accessorRequest,
      symbolRequest,
      cyclicRequest,
      customPrototypeRequest,
      proxyTrapRequest
    ]) {
      expect(screeningEncounterStartRequestSchema.safeParse(request).success).toBe(false)
    }

    expect(getterInvoked).toBe(false)
  })

  it('preserves every sanitized HSD-029A service result status', () => {
    for (const status of [
      'PATIENT_NOT_FOUND',
      'PATIENT_INELIGIBLE',
      'SESSION_NOT_FOUND',
      'SESSION_CLOSED',
      'SESSION_NOT_CURRENT',
      'LOCATION_NOT_FOUND',
      'LOCATION_INACTIVE',
      'FORBIDDEN',
      'VALIDATION_FAILED',
      'AUTHENTICATION_REQUIRED',
      'UNAVAILABLE'
    ] as const) {
      expect(
        screeningEncounterStartResultSchema.parse(createScreeningEncounterStartStatusResult(status))
      ).toEqual(createIpcSuccess({ status }))
    }

    expect(
      screeningEncounterStartResultSchema.parse(createIpcSuccess({ status: 'STARTED', encounter }))
    ).toEqual(createIpcSuccess({ status: 'STARTED', encounter }))
    expect(
      screeningEncounterStartResultSchema.parse(
        createIpcSuccess({ status: 'ALREADY_EXISTS', encounter })
      )
    ).toEqual(createIpcSuccess({ status: 'ALREADY_EXISTS', encounter }))
  })

  it('rejects internal or malformed response fields', () => {
    for (const response of [
      createIpcSuccess({ status: 'STARTED', encounter: { ...encounter, recordedBy: patientId } }),
      createIpcSuccess({ status: 'STARTED', encounter: { ...encounter, status: 'LOCAL' } }),
      createIpcSuccess({ status: 'STARTED', encounter: { ...encounter, startedAt: 'today' } }),
      createIpcSuccess({ status: 'STARTED', encounter: { ...encounter, recordVersion: 0 } }),
      createIpcSuccess({ status: 'UNKNOWN' }),
      { ok: true, data: { status: 'PATIENT_NOT_FOUND' }, extra: true },
      {
        ok: false,
        error: {
          code: 'IPC_FORBIDDEN',
          message: 'arbitrary message'
        }
      }
    ]) {
      expect(screeningEncounterStartResultSchema.safeParse(response).success).toBe(false)
    }
  })

  it('accepts only fixed sanitized IPC boundary failures', () => {
    expect(
      screeningEncounterStartResultSchema.parse(createScreeningEncounterIpcFailure('IPC_FORBIDDEN'))
    ).toEqual(createScreeningEncounterIpcFailure('IPC_FORBIDDEN'))
    expect(
      screeningEncounterStartResultSchema.parse(
        createScreeningEncounterIpcFailure('IPC_UNAVAILABLE')
      )
    ).toEqual(createScreeningEncounterIpcFailure('IPC_UNAVAILABLE'))

    expect(
      screeningEncounterStartSuccessDataSchema.safeParse({
        status: 'STARTED',
        encounter,
        sql: 'SELECT * FROM screening_encounters'
      }).success
    ).toBe(false)
  })
})
