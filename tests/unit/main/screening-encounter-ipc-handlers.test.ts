import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { ScreeningEncounterStartService } from '@main/application'
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
  type PublicScreeningEncounterStartSummary,
  type ScreeningEncounterStartRequest
} from '@shared/ipc'

const patientId = '11111111-1111-4111-8111-111111111111'
const screeningSessionId = '22222222-2222-4222-8222-222222222222'
const encounterId = '33333333-3333-4333-8333-333333333333'
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

describe('screening encounter IPC handlers', () => {
  it('passes only the validated request to the HSD-029A service', async () => {
    const harness = createHarness()

    await expect(harness.handlers.start(createAllowedEvent(), request)).resolves.toEqual(
      createIpcSuccess({ status: 'STARTED', encounter })
    )
    expect(harness.start).toHaveBeenCalledWith(request)
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
      { ...request, referralId: patientId }
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
})

interface HandlerHarness {
  readonly handlers: ScreeningEncounterIpcHandlers
  readonly start: ReturnType<typeof vi.fn>
  readonly logger: TestLogger
}

interface TestLogger extends ScreeningEncounterIpcOperationalLogger {
  warn: ScreeningEncounterIpcOperationalLogger['warn'] & { mock: { calls: unknown[][] } }
  error: ScreeningEncounterIpcOperationalLogger['error'] & { mock: { calls: unknown[][] } }
}

function createHarness({
  result = { status: 'STARTED', encounter: internalEncounter },
  implementation
}: {
  readonly result?: ReturnType<ScreeningEncounterStartService['start']>
  readonly implementation?: ScreeningEncounterStartService['start']
} = {}): HandlerHarness {
  const logger = createLogger()
  const start = vi.fn(implementation ?? (() => result))
  const screeningEncounterStartService = {
    start
  } as unknown as ScreeningEncounterStartService
  const handlers = createScreeningEncounterIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningEncounterStartService,
    logger
  })

  return { handlers, start, logger }
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
