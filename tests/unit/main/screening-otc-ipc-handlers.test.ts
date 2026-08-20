import { describe, expect, it, vi } from 'vitest'

import type { OtcWorkspaceSummary, ScreeningOtcService } from '@main/application'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createScreeningOtcIpcHandlers,
  type ScreeningOtcIpcOperationalLogger
} from '@main/ipc/handlers/screening-otc-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess } from '@shared/ipc'

import {
  otcEncounterId,
  validOtcSaveDraftRequest,
  validOtcWorkspace
} from '../shared/screening-otc-test-fixtures'

const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }

describe('screening OTC IPC handlers', () => {
  it.each([
    ['getWorkspace', 'LOADED'],
    ['saveDraft', 'SAVED']
  ] as const)('maps successful %s calls', async (operation, status) => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const request =
      operation === 'getWorkspace' ? { encounterId: otcEncounterId } : validOtcSaveDraftRequest

    const result = await handlers[operation](event, request)

    expect(result).toEqual(createIpcSuccess({ status, workspace: validOtcWorkspace }))
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('calls only the matching service method with renderer-controlled fields', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)

    await handlers.getWorkspace(event, { encounterId: otcEncounterId })
    await handlers.saveDraft(event, validOtcSaveDraftRequest)

    expect(service.getWorkspace).toHaveBeenCalledWith({ encounterId: otcEncounterId })
    expect(service.saveDraft).toHaveBeenCalledWith(validOtcSaveDraftRequest)
    expect(JSON.stringify(vi.mocked(service.saveDraft).mock.calls[0]?.[0])).not.toMatch(
      /patientId|screeningSessionId|locationId|installationId|actorId|createdAt|updatedAt/iu
    )
  })

  it.each([
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
  ] as const)('returns controlled status %s', async (status) => {
    const service = createServiceWithStatus(status)
    await expect(
      createHandlers(service).saveDraft(event, validOtcSaveDraftRequest)
    ).resolves.toEqual(createIpcSuccess({ status }))
  })

  it('rejects invalid and unsafe requests before service execution', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const accessor = { ...validOtcSaveDraftRequest }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get: () => otcEncounterId
    })
    const cyclic: Record<string, unknown> = { ...validOtcSaveDraftRequest }
    cyclic.cycle = cyclic
    const sparseRows = new Array(1)
    const namedRows = [validOtcSaveDraftRequest.rows[0]]
    Object.defineProperty(namedRows, 'extra', { enumerable: true, value: true })
    const requestViaPrototype: Record<string, unknown> = {}
    Object.defineProperty(requestViaPrototype, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { encounterId: otcEncounterId },
      writable: true
    })
    const validRequestWithPrototype = { ...validOtcSaveDraftRequest }
    Object.defineProperty(validRequestWithPrototype, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { extra: true },
      writable: true
    })
    const rowWithPrototype = { ...validOtcSaveDraftRequest.rows[0] }
    Object.defineProperty(rowWithPrototype, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { extra: true },
      writable: true
    })
    const invalidValues: unknown[] = [
      { ...validOtcSaveDraftRequest, patientId: otcEncounterId },
      { ...validOtcSaveDraftRequest, otcResponse: 'NO' },
      { ...validOtcSaveDraftRequest, rows: [{ ...validOtcSaveDraftRequest.rows[0], extra: true }] },
      accessor,
      cyclic,
      { ...validOtcSaveDraftRequest, rows: sparseRows },
      { ...validOtcSaveDraftRequest, rows: namedRows },
      requestViaPrototype,
      validRequestWithPrototype,
      { ...validOtcSaveDraftRequest, rows: [rowWithPrototype] }
    ]

    for (const value of invalidValues) {
      await expect(handlers.saveDraft(event, value)).resolves.toEqual(
        createIpcSuccess({ status: 'VALIDATION_FAILED' })
      )
    }
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it('rejects forbidden senders without inspecting hostile input', async () => {
    const service = createSuccessfulService()
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('clinical secret')
        }
      }
    )
    const forbiddenFrame = { url: 'https://example.invalid/' }

    await expect(
      createHandlers(service).saveDraft(
        { sender: { mainFrame: forbiddenFrame }, senderFrame: forbiddenFrame },
        hostile
      )
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_FORBIDDEN',
        message: 'This operation is unavailable from the current window.'
      }
    })
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it('sanitizes malformed service results and unexpected exceptions', async () => {
    const invalidService = createSuccessfulService({
      workspace: {
        ...validOtcWorkspace,
        draft: { ...validOtcWorkspace.draft!, rowVersion: 0 }
      } as unknown as OtcWorkspaceSummary
    })
    await expect(
      createHandlers(invalidService).getWorkspace(event, { encounterId: otcEncounterId })
    ).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))

    const malformedRows = new Array(1)
    const malformedResultService = createSuccessfulService({
      workspace: {
        ...validOtcWorkspace,
        draft: { ...validOtcWorkspace.draft!, rows: malformedRows }
      } as unknown as OtcWorkspaceSummary
    })
    await expect(
      createHandlers(malformedResultService).getWorkspace(event, { encounterId: otcEncounterId })
    ).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))

    const logger: ScreeningOtcIpcOperationalLogger & {
      readonly warn: ReturnType<typeof vi.fn<(message: string) => void>>
      readonly error: ReturnType<typeof vi.fn<(message: string) => void>>
    } = { warn: vi.fn(), error: vi.fn() }
    const thrownService = createSuccessfulService({
      implementation: () => {
        throw new Error('C:\\secret\\database.sqlite Pain reliever')
      }
    })
    await expect(
      createHandlers(thrownService, logger).saveDraft(event, validOtcSaveDraftRequest)
    ).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expect(logger.error.mock.calls.join('\n')).not.toMatch(/Pain reliever|database\.sqlite/iu)
    expect(logger.error.mock.calls.join('\n')).toContain('errorType=Error')
  })
})

function createHandlers(
  service: ScreeningOtcService,
  logger?: ScreeningOtcIpcOperationalLogger
): ReturnType<typeof createScreeningOtcIpcHandlers> {
  return createScreeningOtcIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningOtcService: service,
    logger
  })
}

function createSuccessfulService(
  overrides: {
    readonly workspace?: OtcWorkspaceSummary
    readonly implementation?: () => never
  } = {}
): ScreeningOtcService {
  const workspace = overrides.workspace ?? (validOtcWorkspace as unknown as OtcWorkspaceSummary)
  return {
    getWorkspace: vi.fn(() => ({ status: 'LOADED' as const, workspace })),
    saveDraft: vi.fn(() =>
      overrides.implementation
        ? overrides.implementation()
        : { status: 'SAVED' as const, workspace }
    )
  } as unknown as ScreeningOtcService
}

function createServiceWithStatus(status: string): ScreeningOtcService {
  const result = { status }
  return {
    getWorkspace: vi.fn(() => result),
    saveDraft: vi.fn(() => result)
  } as unknown as ScreeningOtcService
}
