import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type {
  ScreeningCompletionService,
  ScreeningEncounterManagementService,
  ScreeningEncounterStartService,
  ScreeningVitalsDraftService
} from '@main/application'
import { parseEntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import {
  createScreeningEncounterIpcHandlers,
  type ScreeningEncounterIpcHandlers,
  type ScreeningEncounterIpcOperationalLogger
} from '@main/ipc/handlers/screening-encounter-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  createScreeningVitalsGetDraftLoadedResult,
  type PublicScreeningEncounterStartSummary,
  type PublicScreeningVitalsDraft,
  type ScreeningEncounterStartRequest
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const screeningSessionId = '22222222-2222-4222-8222-222222222222'
const encounterId = '33333333-3333-4333-8333-333333333333'
const vitalsDraftId = '44444444-4444-4444-8444-444444444444'
const vitalsReadingId = '55555555-5555-4555-8555-555555555555'
const timestamp = '2026-08-06T12:00:00.000Z'
const sensitiveValue = 'Private Patient Session C:\\secret\\database.sqlite SELECT'

const request: ScreeningEncounterStartRequest = {
  patientId,
  screeningSessionId
}

const encounter: PublicScreeningEncounterStartSummary = {
  id: encounterId,
  patientId,
  screeningSessionId,
  status: 'DRAFT',
  startedAt: timestamp,
  recordVersion: 1
}
const internalEncounter = Object.freeze({
  id: parseEntityId(encounterId),
  patientId: parseEntityId(patientId),
  screeningSessionId: parseEntityId(screeningSessionId),
  status: 'DRAFT' as const,
  startedAt: timestamp as UtcTimestamp,
  recordVersion: 1
})
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
  updatedAt: timestamp
}
const internalVitalsDraft = Object.freeze({
  id: parseEntityId(vitalsDraftId),
  encounterId: parseEntityId(encounterId),
  status: 'DRAFT' as const,
  readings: Object.freeze([
    Object.freeze({
      id: parseEntityId(vitalsReadingId),
      sequenceNumber: 1,
      systolic: 120,
      diastolic: null,
      pulse: null,
      measurementSite: 'RIGHT_ARM' as const,
      patientPosition: null,
      measurementTime: null
    })
  ]),
  weightKg: null,
  waistCm: null,
  notes: null,
  rowVersion: 1,
  updatedAt: timestamp as UtcTimestamp
})
const vitalsSaveRequest = Object.freeze({
  encounterId,
  expectedVersion: null,
  readings: Object.freeze([
    Object.freeze({
      id: null,
      sequenceNumber: 1,
      systolic: 120,
      diastolic: null,
      pulse: null,
      measurementSite: 'RIGHT_ARM',
      patientPosition: null,
      measurementTime: null
    })
  ]),
  weightKg: null,
  waistCm: null,
  notes: null
})
const completeRequest = Object.freeze({
  encounterId,
  expectedEncounterVersion: 1,
  expectedVitalsVersion: 2,
  expectedLifestyleVersion: 3,
  expectedFoodVersion: 4,
  expectedOtcVersion: 5,
  reviewConfirmed: true as const,
  alcoholBaselineReviewConfirmedVersionId: null,
  tobaccoBaselineReviewConfirmedVersionId: null
})

describe('screening encounter IPC handlers', () => {
  it('passes only the validated request to the HSD-029A service', async () => {
    const harness = createHarness()

    await expect(harness.handlers.start(createAllowedEvent(), request)).resolves.toEqual(
      createIpcSuccess({ status: 'STARTED', encounter })
    )
    expect(harness.start).toHaveBeenCalledWith({ ...request, repeatConfirmed: false })
    expect(harness.start.mock.calls[0]).toHaveLength(1)
    expect(Object.isFrozen(await harness.handlers.start(createAllowedEvent(), request))).toBe(true)
  })

  it('rejects untrusted senders before request parsing or service invocation', async () => {
    const harness = createHarness()
    let requestInspected = false
    const hostileRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          requestInspected = true
          throw new Error(sensitiveValue)
        }
      }
    )

    await expect(harness.handlers.start(createForbiddenEvent(), hostileRequest)).resolves.toEqual(
      createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
    )
    expect(requestInspected).toBe(false)
    expect(harness.start).not.toHaveBeenCalled()
  })

  it('validates and maps completion without exposing internal fields', async () => {
    const harness = createHarness()
    harness.completion.mockReturnValue({
      status: 'COMPLETED',
      encounter: {
        ...internalEncounter,
        status: 'COMPLETED',
        completedAt: timestamp as UtcTimestamp,
        recordVersion: 2
      }
    })

    await expect(harness.handlers.complete(createAllowedEvent(), completeRequest)).resolves.toEqual(
      createIpcSuccess({
        status: 'COMPLETED',
        encounter: {
          ...encounter,
          status: 'COMPLETED',
          completedAt: timestamp,
          recordVersion: 2
        }
      })
    )
    expect(harness.completion).toHaveBeenCalledWith(completeRequest)

    const invalidHarness = createHarness()
    await expect(
      invalidHarness.handlers.complete(createAllowedEvent(), {
        ...completeRequest,
        reviewConfirmed: false
      })
    ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(invalidHarness.completion).not.toHaveBeenCalled()
  })

  it('rejects malformed and over-posted requests without stripping forbidden fields', async () => {
    for (const invalidRequest of [
      {},
      { patientId },
      { patientId: 'bad-id', screeningSessionId },
      { ...request, actor: { userId: patientId, role: 'LOCAL_ADMIN' } },
      { ...request, userId: patientId },
      { ...request, role: 'NURSE' },
      { ...request, locationId: patientId },
      { ...request, encounterId },
      { ...request, status: 'DRAFT' },
      { ...request, sessionDate: '2026-08-06' },
      { ...request, systolic: 120 },
      { ...request, referralId: patientId },
      { ...request, repeatConfirmed: 'yes' }
    ]) {
      const harness = createHarness()

      await expect(harness.handlers.start(createAllowedEvent(), invalidRequest)).resolves.toEqual(
        createScreeningEncounterStartStatusResult('VALIDATION_FAILED')
      )
      expect(harness.start).not.toHaveBeenCalled()
    }
  })

  it('preserves expected HSD-029A service outcomes as typed results', async () => {
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
      'REPEAT_CONFIRMATION_REQUIRED',
      'UNAVAILABLE'
    ] as const) {
      await expect(
        createHarness({ result: { status } }).handlers.start(createAllowedEvent(), request)
      ).resolves.toEqual(createScreeningEncounterStartStatusResult(status))
    }

    await expect(
      createHarness({
        result: { status: 'ALREADY_EXISTS', encounter: internalEncounter }
      }).handlers.start(createAllowedEvent(), request)
    ).resolves.toEqual(createIpcSuccess({ status: 'ALREADY_EXISTS', encounter }))
  })

  it('fails closed for malformed service output and thrown failures without sensitive values', async () => {
    const malformedHarness = createHarness({
      result: {
        status: 'STARTED',
        encounter: { ...internalEncounter, recordVersion: 0 }
      } as never
    })
    const thrownHarness = createHarness({
      implementation: () => {
        throw new Error(sensitiveValue)
      }
    })

    await expect(malformedHarness.handlers.start(createAllowedEvent(), request)).resolves.toEqual(
      createScreeningEncounterStartStatusResult('UNAVAILABLE')
    )
    await expect(thrownHarness.handlers.start(createAllowedEvent(), request)).resolves.toEqual(
      createScreeningEncounterStartStatusResult('UNAVAILABLE')
    )
    expectLogsAreSafe(malformedHarness.logger)
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('maps validated Vitals draft requests through the fixed handlers', async () => {
    const harness = createHarness()

    harness.vitals.getVitalsDraft.mockReturnValue({
      status: 'LOADED',
      draft: internalVitalsDraft
    })
    harness.vitals.saveVitalsDraft.mockReturnValue({
      status: 'SAVED',
      draft: internalVitalsDraft
    })
    harness.vitals.completeVitalsStep.mockReturnValue({
      status: 'COMPLETED',
      draft: { ...internalVitalsDraft, status: 'VITALS_COMPLETE' }
    })

    await expect(
      harness.handlers.getVitalsDraft(createAllowedEvent(), { encounterId })
    ).resolves.toEqual(createScreeningVitalsGetDraftLoadedResult(vitalsDraft))
    await expect(
      harness.handlers.saveVitalsDraft(createAllowedEvent(), vitalsSaveRequest)
    ).resolves.toEqual(createIpcSuccess({ status: 'SAVED', draft: vitalsDraft }))
    await expect(
      harness.handlers.completeVitalsStep(createAllowedEvent(), vitalsSaveRequest)
    ).resolves.toEqual(
      createIpcSuccess({
        status: 'COMPLETED',
        draft: { ...vitalsDraft, status: 'VITALS_COMPLETE' }
      })
    )

    expect(harness.vitals.getVitalsDraft).toHaveBeenCalledWith({ encounterId })
    expect(harness.vitals.saveVitalsDraft).toHaveBeenCalledWith(vitalsSaveRequest)
    expect(harness.vitals.completeVitalsStep).toHaveBeenCalledWith(vitalsSaveRequest)
    expect(harness.vitals.saveVitalsDraft.mock.calls[0]).toHaveLength(1)
  })

  it('rejects untrusted Vitals draft senders before parsing or service invocation', async () => {
    const harness = createHarness()
    let requestInspected = false
    const hostileRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          requestInspected = true
          throw new Error(sensitiveValue)
        }
      }
    )

    await expect(
      harness.handlers.saveVitalsDraft(createForbiddenEvent(), hostileRequest)
    ).resolves.toEqual(createScreeningEncounterIpcFailure('IPC_FORBIDDEN'))
    expect(requestInspected).toBe(false)
    expect(harness.vitals.saveVitalsDraft).not.toHaveBeenCalled()
  })

  it('strictly rejects invalid or authority-bearing Vitals draft IPC requests', async () => {
    for (const invalidGetRequest of [
      {},
      { encounterId: 'bad-id' },
      { encounterId, actor: { userId: patientId } },
      { encounterId, role: 'NURSE' },
      { encounterId, patientId },
      { encounterId, screeningSessionId },
      { encounterId, locationId: patientId }
    ]) {
      const harness = createHarness()

      await expect(
        harness.handlers.getVitalsDraft(createAllowedEvent(), invalidGetRequest)
      ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
      expect(harness.vitals.getVitalsDraft).not.toHaveBeenCalled()
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
      const harness = createHarness()

      await expect(
        harness.handlers.saveVitalsDraft(createAllowedEvent(), invalidSaveRequest)
      ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
      expect(harness.vitals.saveVitalsDraft).not.toHaveBeenCalled()
    }
  })

  it('preserves controlled Vitals outcomes and sanitizes malformed Vitals failures', async () => {
    for (const status of [
      'AUTHENTICATION_REQUIRED',
      'FORBIDDEN',
      'VALIDATION_FAILED',
      'LOCATION_NOT_CONFIGURED',
      'LOCATION_NOT_FOUND',
      'LOCATION_INACTIVE',
      'ENCOUNTER_NOT_FOUND',
      'ENCOUNTER_NOT_EDITABLE',
      'SESSION_NOT_FOUND',
      'SESSION_CLOSED',
      'SESSION_NOT_CURRENT',
      'VERSION_CONFLICT',
      'UNAVAILABLE'
    ] as const) {
      const harness = createHarness()

      harness.vitals.completeVitalsStep.mockReturnValue({ status })
      await expect(
        harness.handlers.completeVitalsStep(createAllowedEvent(), vitalsSaveRequest)
      ).resolves.toEqual(createIpcSuccess({ status }))
    }

    const malformedHarness = createHarness()
    const thrownHarness = createHarness()

    malformedHarness.vitals.saveVitalsDraft.mockReturnValue({
      status: 'SAVED',
      draft: { ...internalVitalsDraft, rowVersion: 0 }
    } as never)
    thrownHarness.vitals.getVitalsDraft.mockImplementation(() => {
      throw new Error(sensitiveValue)
    })

    await expect(
      malformedHarness.handlers.saveVitalsDraft(createAllowedEvent(), vitalsSaveRequest)
    ).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    await expect(
      thrownHarness.handlers.getVitalsDraft(createAllowedEvent(), { encounterId })
    ).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expectLogsAreSafe(malformedHarness.logger)
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('validates and forwards the bounded patient-history request', async () => {
    const getPatientHistory = vi.fn<ScreeningEncounterManagementService['getPatientHistory']>(
      () => ({
        status: 'LOADED',
        history: {
          patientId: parseEntityId(patientId),
          items: [],
          total: 0,
          page: 1,
          pageSize: 25,
          trendEncounters: [],
          thirtyDayAverage: null
        }
      })
    )
    const harness = createHarness({
      managementService: { getPatientHistory } as unknown as ScreeningEncounterManagementService
    })

    await expect(
      harness.handlers.getPatientScreeningHistory(createAllowedEvent(), {
        patientId,
        page: 1,
        pageSize: 25
      })
    ).resolves.toEqual(
      createIpcSuccess({
        status: 'LOADED',
        history: {
          patientId,
          items: [],
          total: 0,
          page: 1,
          pageSize: 25,
          trendEncounters: [],
          thirtyDayAverage: null
        }
      })
    )
    expect(getPatientHistory).toHaveBeenCalledWith(parseEntityId(patientId), 1, 25)
  })
})

interface HandlerHarness {
  readonly handlers: ScreeningEncounterIpcHandlers
  readonly start: ReturnType<typeof vi.fn>
  readonly vitals: {
    readonly getVitalsDraft: ReturnType<typeof vi.fn>
    readonly saveVitalsDraft: ReturnType<typeof vi.fn>
    readonly completeVitalsStep: ReturnType<typeof vi.fn>
  }
  readonly completion: ReturnType<typeof vi.fn>
  readonly logger: TestLogger
}

interface TestLogger extends ScreeningEncounterIpcOperationalLogger {
  warn: ScreeningEncounterIpcOperationalLogger['warn'] & { mock: { calls: unknown[][] } }
  error: ScreeningEncounterIpcOperationalLogger['error'] & { mock: { calls: unknown[][] } }
}

function createHarness({
  result = { status: 'STARTED', encounter: internalEncounter },
  implementation,
  managementService
}: {
  readonly result?: ReturnType<ScreeningEncounterStartService['start']>
  readonly implementation?: ScreeningEncounterStartService['start']
  readonly managementService?: ScreeningEncounterManagementService
} = {}): HandlerHarness {
  const logger = createLogger()
  const start = vi.fn(implementation ?? (() => result))
  const screeningEncounterStartService = {
    start
  } as unknown as ScreeningEncounterStartService
  const vitals = createScreeningVitalsDraftService()
  const completion = vi.fn<ScreeningCompletionService['complete']>(() => ({
    status: 'UNAVAILABLE'
  }))
  const handlers = createScreeningEncounterIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningEncounterStartService,
    screeningVitalsDraftService: vitals as unknown as ScreeningVitalsDraftService,
    screeningCompletionService: { complete: completion },
    screeningEncounterManagementService: managementService,
    logger
  })

  return { handlers, start, vitals, completion, logger }
}

function createScreeningVitalsDraftService(): HandlerHarness['vitals'] {
  return {
    getVitalsDraft: vi.fn(() => ({ status: 'UNAVAILABLE' })),
    saveVitalsDraft: vi.fn(() => ({ status: 'UNAVAILABLE' })),
    completeVitalsStep: vi.fn(() => ({ status: 'UNAVAILABLE' }))
  }
}

function createAllowedEvent(): IpcSenderValidationEvent {
  return createEvent('http://localhost:5173/')
}

function createForbiddenEvent(): IpcSenderValidationEvent {
  return createEvent('https://example.invalid/')
}

function createEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}

function createLogger(): TestLogger {
  return {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function expectLogsAreSafe(logger: TestLogger): void {
  const logs = logger.warn.mock.calls.concat(logger.error.mock.calls).join('\n')

  expect(logs).not.toContain('Private Patient')
  expect(logs).not.toContain('SELECT')
  expect(logs).not.toContain('C:\\')
  expect(logs).not.toContain('database.sqlite')
}
