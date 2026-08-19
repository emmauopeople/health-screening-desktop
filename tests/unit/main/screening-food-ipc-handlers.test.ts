import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { FoodWorkspaceSummary, ScreeningFoodService } from '@main/application'
import {
  createScreeningFoodIpcHandlers,
  type ScreeningFoodIpcOperationalLogger
} from '@main/ipc/handlers/screening-food-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

import {
  foodEncounterId,
  validFoodSaveDraftRequest,
  validFoodWorkspace
} from '../shared/screening-food-test-fixtures'

const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }
const validFoodDraft = validFoodWorkspace.draft!

describe('screening Food IPC handlers', () => {
  it.each([
    ['getWorkspace', 'LOADED'],
    ['saveDraft', 'SAVED']
  ] as const)('maps a successful %s operation', async (operation, status) => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const result = await handlers[operation](event, operationRequest(operation))

    expect(result).toEqual(createIpcSuccess({ status, workspace: validFoodWorkspace }))
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('passes only the validated renderer-controlled request fields to the Food service', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)

    await handlers.getWorkspace(event, { encounterId: foodEncounterId })
    await handlers.saveDraft(event, validFoodSaveDraftRequest)

    expect(service.getWorkspace).toHaveBeenCalledWith({ encounterId: foodEncounterId })
    expect(service.saveDraft).toHaveBeenCalledWith(validFoodSaveDraftRequest)
    expect(JSON.stringify(vi.mocked(service.saveDraft).mock.calls[0]?.[0])).not.toMatch(
      /patientId|screeningSessionId|locationId|installationId|actorId|createdAt|updatedAt/u
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
  ] as const)('propagates controlled service status %s', async (status) => {
    const service = createServiceWithStatus(status)

    await expect(
      createHandlers(service).saveDraft(event, validFoodSaveDraftRequest)
    ).resolves.toEqual(createIpcSuccess({ status }))
  })

  it('rejects invalid allowed-sender requests before service execution', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const invalidValues = [
      { encounterId: foodEncounterId, extra: true },
      { ...validFoodSaveDraftRequest, patientId: foodEncounterId },
      { ...validFoodSaveDraftRequest, actorId: foodEncounterId },
      { ...validFoodSaveDraftRequest, foodResponse: 'YES' },
      {
        ...validFoodSaveDraftRequest,
        rows: [{ ...validFoodSaveDraftRequest.rows[0], extra: true }]
      },
      {
        ...validFoodSaveDraftRequest,
        rows: [{ ...validFoodSaveDraftRequest.rows[0], foodName: '' }]
      }
    ]

    for (const invalid of invalidValues) {
      const result = await handlers.saveDraft(event, invalid)
      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
      expect(JSON.stringify(result)).not.toContain('Rice')
    }
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it('rejects unsafe allowed-sender input before service execution', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const accessor = { ...validFoodSaveDraftRequest }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get: () => foodEncounterId
    })
    const customPrototype = Object.setPrototypeOf(
      { ...validFoodSaveDraftRequest },
      { trusted: true }
    )
    const cyclic: Record<string, unknown> = { ...validFoodSaveDraftRequest }
    cyclic.cycle = cyclic
    const symbolBearing = Object.defineProperty(
      { ...validFoodSaveDraftRequest },
      Symbol('secret'),
      {
        enumerable: true,
        value: 'Rice'
      }
    )
    const descriptorTrap = new Proxy(
      { ...validFoodSaveDraftRequest },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('C:\\secret\\input Rice')
        }
      }
    )

    for (const invalid of [accessor, customPrototype, cyclic, symbolBearing, descriptorTrap]) {
      const result = await handlers.saveDraft(event, invalid)
      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
      expect(JSON.stringify(result)).not.toContain('C:\\secret')
      expect(JSON.stringify(result)).not.toContain('Rice')
    }
    expect(service.saveDraft).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender before inspecting input', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('Rice secret')
        }
      }
    )
    const forbiddenFrame = { url: 'https://example.invalid/' }

    await expect(
      handlers.saveDraft(
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

  it('maps invalid service results and thrown exceptions to unavailable without leaking details', async () => {
    const invalidService = createSuccessfulService({
      workspace: {
        ...validFoodWorkspace,
        draft: { ...validFoodDraft, rowVersion: 0 }
      } as never
    })
    const invalidResult = await createHandlers(invalidService).getWorkspace(event, {
      encounterId: foodEncounterId
    })
    expect(invalidResult).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))

    const logger: ScreeningFoodIpcOperationalLogger & {
      readonly warn: ReturnType<typeof vi.fn<(message: string) => void>>
      readonly error: ReturnType<typeof vi.fn<(message: string) => void>>
    } = {
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>()
    }
    const thrownService = createSuccessfulService({
      implementation: () => {
        throw new Error('C:\\secret\\database.sqlite SELECT Rice Boiled')
      }
    })
    const thrownResult = await createHandlers(thrownService, logger).saveDraft(
      event,
      validFoodSaveDraftRequest
    )

    expect(thrownResult).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expect(JSON.stringify(thrownResult)).not.toContain('Rice')
    expect(logger.error.mock.calls.join('\n')).not.toContain('Rice')
    expect(logger.error.mock.calls.join('\n')).not.toContain('database.sqlite')
    expect(logger.error.mock.calls.join('\n')).toContain(
      `${ipcChannels.screeningEncounters.food.saveDraft}`
    )
    expect(logger.error.mock.calls.join('\n')).toContain('errorType=Error')
  })
})

function operationRequest(operation: string): unknown {
  switch (operation) {
    case 'getWorkspace':
      return { encounterId: foodEncounterId }
    case 'saveDraft':
      return validFoodSaveDraftRequest
    default:
      return validFoodSaveDraftRequest
  }
}

function createHandlers(
  service: ScreeningFoodService,
  logger?: ScreeningFoodIpcOperationalLogger
): ReturnType<typeof createScreeningFoodIpcHandlers> {
  return createScreeningFoodIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningFoodService: service,
    logger
  })
}

function createSuccessfulService(
  overrides: {
    workspace?: FoodWorkspaceSummary
    implementation?: () => never
  } = {}
): ScreeningFoodService {
  const workspace = overrides.workspace ?? (validFoodWorkspace as unknown as FoodWorkspaceSummary)
  return {
    getWorkspace: vi.fn(() => ({ status: 'LOADED' as const, workspace })),
    saveDraft: vi.fn(() =>
      overrides.implementation
        ? overrides.implementation()
        : { status: 'SAVED' as const, workspace }
    )
  } as unknown as ScreeningFoodService
}

function createServiceWithStatus(status: Parameters<typeof createStatus>[0]): ScreeningFoodService {
  const result = createStatus(status)
  return {
    getWorkspace: vi.fn(() => result),
    saveDraft: vi.fn(() => result)
  } as unknown as ScreeningFoodService
}

function createStatus(status: string): { readonly status: string } {
  return { status }
}
