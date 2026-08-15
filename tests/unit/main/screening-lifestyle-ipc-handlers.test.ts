import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { LifestyleWorkspaceSummary, ScreeningLifestyleService } from '@main/application'
import {
  createScreeningLifestyleIpcHandlers,
  type ScreeningLifestyleIpcOperationalLogger
} from '@main/ipc/handlers/screening-lifestyle-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

import {
  lifestyleEncounterId,
  validLifestyleWorkspace
} from '../shared/screening-lifestyle-test-fixtures'

const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }
const request = {
  encounterId: lifestyleEncounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivityResponse: null,
  otherActivities: []
}
const alcoholBaselineRequest = {
  encounterId: lifestyleEncounterId,
  expectedBaselineVersion: null,
  expectedDraftVersion: null,
  status: 'CURRENT',
  everConsumed: 'YES',
  consumedPast12Months: 'YES',
  commonBeverageTypes: [],
  otherBeverageDescription: null
} as const
const tobaccoBaselineRequest = {
  encounterId: lifestyleEncounterId,
  expectedBaselineVersion: null,
  expectedDraftVersion: null,
  status: 'NEVER',
  everRegularlyUsed: 'NO',
  formerUseApproximateStopDate: null,
  currentUseFrequency: 'NOT_AT_ALL',
  productTypes: [],
  otherProductDescription: null
} as const
const workBaselineRequest = {
  encounterId: lifestyleEncounterId,
  expectedBaselineVersion: null,
  expectedDraftVersion: null,
  status: 'EMPLOYED',
  occupationJobTitle: null,
  usualPhysicalDemand: null,
  typicalWorkdaysPerWeek: null,
  typicalHoursPerWorkday: null,
  shiftPattern: null,
  description: null
} as const
const completeRequest = {
  ...request,
  alcoholBaselineReviewConfirmedVersionId: null,
  tobaccoBaselineReviewConfirmedVersionId: null
} as const

describe('screening Lifestyle IPC handlers', () => {
  it.each([
    ['getWorkspace', 'LOADED'],
    ['saveAlcoholBaseline', 'SAVED'],
    ['saveTobaccoBaseline', 'SAVED'],
    ['saveWorkBaseline', 'SAVED'],
    ['saveDraft', 'SAVED'],
    ['complete', 'COMPLETED']
  ] as const)('maps a successful %s operation', async (operation, status) => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const result = await handlers[operation](event, operationRequest(operation))

    expect(result).toEqual(createIpcSuccess({ status, workspace: validLifestyleWorkspace }))
  })

  it('passes the exact validated request to every matching L3A operation', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)

    await handlers.getWorkspace(event, { encounterId: lifestyleEncounterId })
    await handlers.saveAlcoholBaseline(event, alcoholBaselineRequest)
    await handlers.saveTobaccoBaseline(event, tobaccoBaselineRequest)
    await handlers.saveWorkBaseline(event, workBaselineRequest)
    await handlers.saveDraft(event, request)
    await handlers.complete(event, completeRequest)

    expect(service.getLifestyleWorkspace).toHaveBeenCalledWith({
      encounterId: lifestyleEncounterId
    })
    expect(service.saveAlcoholBaseline).toHaveBeenCalledWith(alcoholBaselineRequest)
    expect(service.saveTobaccoBaseline).toHaveBeenCalledWith(tobaccoBaselineRequest)
    expect(service.saveWorkBaseline).toHaveBeenCalledWith(workBaselineRequest)
    expect(service.saveLifestyleDraft).toHaveBeenCalledWith(request)
    expect(service.completeLifestyle).toHaveBeenCalledWith(completeRequest)
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
    const result = await createHandlers(service).saveDraft(event, request)

    expect(result).toEqual(createIpcSuccess({ status }))
  })

  it('returns validation failure for completion and baseline-review validation failures', async () => {
    const service = createServiceWithStatus('VALIDATION_FAILED')
    const handlers = createHandlers(service)

    await expect(handlers.complete(event, completeRequest)).resolves.toEqual(
      createIpcSuccess({ status: 'VALIDATION_FAILED' })
    )
    await expect(handlers.saveAlcoholBaseline(event, alcoholBaselineRequest)).resolves.toEqual(
      createIpcSuccess({ status: 'VALIDATION_FAILED' })
    )
  })

  it('rejects unsafe allowed-sender input before service execution', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const accessor = { ...request }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get: () => lifestyleEncounterId
    })
    const customPrototype = Object.setPrototypeOf({ ...request }, { trusted: true })
    const cyclic: Record<string, unknown> = { ...request }
    cyclic.cycle = cyclic
    const symbolBearing = Object.defineProperty({ ...request }, Symbol('secret'), {
      enumerable: true,
      value: 'clinical-secret'
    })
    const descriptorTrap = new Proxy(
      { ...request },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('C:\\secret\\input')
        }
      }
    )
    const invalidValues = [
      { ...request, extra: true },
      { ...request, actorId: lifestyleEncounterId },
      { ...request, patientId: lifestyleEncounterId },
      accessor,
      customPrototype,
      cyclic,
      symbolBearing,
      descriptorTrap
    ]

    for (const invalid of invalidValues) {
      const result = await handlers.saveDraft(event, invalid)
      expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
      expect(JSON.stringify(result)).not.toContain('clinical-secret')
      expect(JSON.stringify(result)).not.toContain('C:\\secret')
    }
    expect(service.saveLifestyleDraft).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender before inspecting input', async () => {
    const service = createSuccessfulService()
    const handlers = createHandlers(service)
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('secret')
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
    expect(service.saveLifestyleDraft).not.toHaveBeenCalled()
  })

  it('maps invalid service results and thrown exceptions to unavailable without leaking details', async () => {
    const invalidService = createSuccessfulService({
      workspace: {
        ...validLifestyleWorkspace,
        draft: { ...validLifestyleWorkspace.draft, rowVersion: 0 }
      } as never
    })
    const invalidResult = await createHandlers(invalidService).getWorkspace(event, {
      encounterId: lifestyleEncounterId
    })
    expect(invalidResult).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))

    const logger: ScreeningLifestyleIpcOperationalLogger & {
      readonly warn: ReturnType<typeof vi.fn<(message: string) => void>>
      readonly error: ReturnType<typeof vi.fn<(message: string) => void>>
    } = {
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>()
    }
    const thrownService = createSuccessfulService({
      implementation: () => {
        throw new Error('C:\\secret\\database.sqlite SELECT clinical-value')
      }
    })
    const thrownResult = await createHandlers(thrownService, logger).saveDraft(event, request)
    expect(thrownResult).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expect(JSON.stringify(thrownResult)).not.toContain('secret')
    expect(logger.error.mock.calls.join('\n')).not.toContain('clinical-value')
    expect(logger.error.mock.calls.join('\n')).not.toContain('database.sqlite')
    expect(logger.error.mock.calls.join('\n')).toContain(
      `${ipcChannels.screeningEncounters.lifestyle.saveDraft}`
    )
    expect(logger.error.mock.calls.join('\n')).toContain('errorType=Error')
  })
})

function operationRequest(operation: string): unknown {
  switch (operation) {
    case 'getWorkspace':
      return { encounterId: lifestyleEncounterId }
    case 'saveAlcoholBaseline':
      return alcoholBaselineRequest
    case 'saveTobaccoBaseline':
      return tobaccoBaselineRequest
    case 'saveWorkBaseline':
      return workBaselineRequest
    case 'saveDraft':
      return request
    case 'complete':
      return completeRequest
    default:
      return request
  }
}

function createHandlers(
  service: ScreeningLifestyleService,
  logger?: ScreeningLifestyleIpcOperationalLogger
): ReturnType<typeof createScreeningLifestyleIpcHandlers> {
  return createScreeningLifestyleIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningLifestyleService: service,
    logger
  })
}

function createSuccessfulService(
  overrides: {
    workspace?: LifestyleWorkspaceSummary
    implementation?: () => never
  } = {}
): ScreeningLifestyleService {
  const workspace = overrides.workspace ?? validLifestyleWorkspace
  return {
    getLifestyleWorkspace: vi.fn(() => ({ status: 'LOADED' as const, workspace })),
    saveAlcoholBaseline: vi.fn(() => ({ status: 'SAVED' as const, workspace })),
    saveTobaccoBaseline: vi.fn(() => ({ status: 'SAVED' as const, workspace })),
    saveWorkBaseline: vi.fn(() => ({ status: 'SAVED' as const, workspace })),
    saveLifestyleDraft: vi.fn(() =>
      overrides.implementation
        ? overrides.implementation()
        : { status: 'SAVED' as const, workspace }
    ),
    completeLifestyle: vi.fn(() => ({ status: 'COMPLETED' as const, workspace }))
  } as unknown as ScreeningLifestyleService
}

function createServiceWithStatus(
  status: Parameters<typeof createStatus>[0]
): ScreeningLifestyleService {
  const result = createStatus(status)
  return {
    getLifestyleWorkspace: vi.fn(() => result),
    saveAlcoholBaseline: vi.fn(() => result),
    saveTobaccoBaseline: vi.fn(() => result),
    saveWorkBaseline: vi.fn(() => result),
    saveLifestyleDraft: vi.fn(() => result),
    completeLifestyle: vi.fn(() => result)
  } as unknown as ScreeningLifestyleService
}

function createStatus(status: string): { readonly status: string } {
  return { status }
}
