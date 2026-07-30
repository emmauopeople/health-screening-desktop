import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError,
  type FirstRunBootstrapService,
  type FirstRunBootstrapState,
  type FirstRunInitializationResult
} from '@main/application'
import {
  createFirstRunIpcHandlers,
  type FirstRunIpcHandlers,
  type FirstRunIpcOperationalLogger
} from '@main/ipc/handlers/first-run-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createFirstRunFailure,
  createIpcSuccess,
  ipcChannels,
  type FirstRunInitializeRequest
} from '@shared/ipc'

const validRequest: FirstRunInitializeRequest = {
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

describe('first-run IPC handlers', () => {
  it('returns each minimized public state variant', async () => {
    const requiredHandlers = createHandlers({
      getState: () => ({ status: 'REQUIRED' })
    })
    const initializedHandlers = createHandlers({
      getState: () => createInitializedInternalState()
    })
    const inconsistentHandlers = createHandlers({
      getState: () => ({
        status: 'INCONSISTENT',
        code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      })
    })

    await expect(requiredHandlers.getState(createAllowedEvent(), {})).resolves.toEqual(
      createIpcSuccess({ status: 'REQUIRED' })
    )
    await expect(initializedHandlers.getState(createAllowedEvent(), {})).resolves.toEqual(
      createIpcSuccess({
        status: 'INITIALIZED',
        deploymentName: 'Cameroon Pilot',
        timeZone: 'Africa/Douala'
      })
    )
    await expect(inconsistentHandlers.getState(createAllowedEvent(), {})).resolves.toEqual(
      createIpcSuccess({
        status: 'INCONSISTENT',
        code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      })
    )
    expect(
      JSON.stringify(await initializedHandlers.getState(createAllowedEvent(), {}))
    ).not.toContain('11111111-1111-4111-8111-111111111111')
    expect(
      JSON.stringify(await initializedHandlers.getState(createAllowedEvent(), {}))
    ).not.toContain('2026-07-29')
  })

  it('initializes through HSD-014 and returns only initialized public state', async () => {
    const initialize = vi.fn(async () => createInitializationResult())
    const handlers = createHandlers({ initialize })

    await expect(handlers.initialize(createAllowedEvent(), validRequest)).resolves.toEqual(
      createIpcSuccess({
        status: 'INITIALIZED',
        deploymentName: 'Cameroon Pilot',
        timeZone: 'Africa/Douala'
      })
    )
    expect(initialize).toHaveBeenCalledWith(validRequest)
    const response = await handlers.initialize(createAllowedEvent(), validRequest)
    const serialized = JSON.stringify(response)

    for (const unsafeFragment of [
      'ValidPassw0rd',
      'Admin.User',
      'Central Church',
      'auditEvents',
      'metadata',
      'passwordHash',
      'passwordSalt',
      '11111111-1111-4111-8111-111111111111',
      '2026-07-29'
    ]) {
      expect(serialized).not.toContain(unsafeFragment)
    }
  })

  it('rejects forbidden senders before parsing or invoking the service', async () => {
    const service = createService()
    const handlers = createHandlers({ service })
    const hostileRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(handlers.initialize(createForbiddenEvent(), hostileRequest)).resolves.toEqual(
      createFirstRunFailure('IPC_FORBIDDEN')
    )
    await expect(handlers.getState(createForbiddenEvent(), hostileRequest)).resolves.toEqual(
      createFirstRunFailure('IPC_FORBIDDEN')
    )
    expect(service.getState).not.toHaveBeenCalled()
    expect(service.initialize).not.toHaveBeenCalled()
  })

  it('rejects malformed requests before invoking HSD-014', async () => {
    const service = createService()
    const handlers = createHandlers({ service })
    const descriptorTrapRequest = new Proxy(
      { ...validRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(
      handlers.initialize(createAllowedEvent(), { ...validRequest, extra: true })
    ).resolves.toEqual(createFirstRunFailure('VALIDATION_FAILED'))
    await expect(handlers.initialize(createAllowedEvent(), descriptorTrapRequest)).resolves.toEqual(
      createFirstRunFailure('VALIDATION_FAILED')
    )
    await expect(handlers.getState(createAllowedEvent(), { extra: true })).resolves.toEqual(
      createFirstRunFailure('VALIDATION_FAILED')
    )
    expect(service.getState).not.toHaveBeenCalled()
    expect(service.initialize).not.toHaveBeenCalled()
  })

  it('maps reviewed HSD-014 errors to exact first-run IPC codes', async () => {
    const cases = [
      [new FirstRunValidationError(), 'VALIDATION_FAILED'],
      [new FirstRunAlreadyInitializedError(), 'FIRST_RUN_ALREADY_INITIALIZED'],
      [new FirstRunStateIntegrityError(), 'FIRST_RUN_STATE_INTEGRITY'],
      [new FirstRunInitializationInProgressError(), 'FIRST_RUN_INITIALIZATION_IN_PROGRESS'],
      [new FirstRunInitializationError(), 'FIRST_RUN_INITIALIZATION_FAILED']
    ] as const

    for (const [error, code] of cases) {
      const handlers = createHandlers({
        initialize: () => {
          throw error
        }
      })

      await expect(handlers.initialize(createAllowedEvent(), validRequest)).resolves.toEqual(
        createFirstRunFailure(code)
      )
    }
  })

  it('maps unknown throws and malformed trusted output to INTERNAL_ERROR', async () => {
    const unknownThrowHandlers = createHandlers({
      initialize: () => {
        throw new Error('C:\\secret\\raw-message.txt')
      }
    })
    const malformedStateHandlers = createHandlers({
      getState: () =>
        ({
          status: 'INITIALIZED',
          installation: {
            ...createInitializedInternalState().installation,
            deploymentName: ''
          }
        }) as FirstRunBootstrapState
    })
    const malformedInitializeHandlers = createHandlers({
      initialize: async () =>
        ({
          ...createInitializationResult(),
          installation: {
            ...createInitializationResult().installation,
            timeZone: ''
          }
        }) as unknown as FirstRunInitializationResult
    })

    await expect(
      unknownThrowHandlers.initialize(createAllowedEvent(), validRequest)
    ).resolves.toEqual(createFirstRunFailure('INTERNAL_ERROR'))
    await expect(malformedStateHandlers.getState(createAllowedEvent(), {})).resolves.toEqual(
      createFirstRunFailure('INTERNAL_ERROR')
    )
    await expect(
      malformedInitializeHandlers.initialize(createAllowedEvent(), validRequest)
    ).resolves.toEqual(createFirstRunFailure('INTERNAL_ERROR'))
  })

  it('logs only channel, code, and reviewed error type', async () => {
    const logger = createLogger()
    const handlers = createHandlers({
      logger,
      initialize: () => {
        throw new Error('C:\\secret\\raw-message.txt ValidPassw0rd! Central Church')
      }
    })

    await handlers.initialize(createAllowedEvent(), validRequest)
    await handlers.getState(createForbiddenEvent(), { extra: 'Secret Value' })

    const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

    expect(logs).toContain(`channel=${ipcChannels.firstRun.initialize}`)
    expect(logs).toContain('code=INTERNAL_ERROR')
    expect(logs).toContain(`channel=${ipcChannels.firstRun.getState}`)
    expect(logs).toContain('code=IPC_FORBIDDEN')
    expect(logs).toContain('errorType=Error')

    for (const unsafeFragment of [
      'ValidPassw0rd',
      'Central Church',
      'Secret Value',
      'raw-message',
      'C:\\',
      '2026-07-29',
      '11111111-1111-4111-8111-111111111111'
    ]) {
      expect(logs).not.toContain(unsafeFragment)
    }
  })
})

interface HandlerOverrides {
  service?: FirstRunBootstrapService
  getState?: FirstRunBootstrapService['getState']
  initialize?: FirstRunBootstrapService['initialize']
  logger?: TestLogger
}

interface TestLogger extends FirstRunIpcOperationalLogger {
  warn: FirstRunIpcOperationalLogger['warn'] & {
    mock: { calls: unknown[][] }
  }
  error: FirstRunIpcOperationalLogger['error'] & {
    mock: { calls: unknown[][] }
  }
}

function createHandlers(overrides: HandlerOverrides = {}): FirstRunIpcHandlers {
  return createFirstRunIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    firstRunBootstrapService:
      overrides.service ??
      createService({
        getState: overrides.getState,
        initialize: overrides.initialize
      }),
    logger: overrides.logger ?? createLogger()
  })
}

function createService(
  overrides: Partial<Pick<FirstRunBootstrapService, 'getState' | 'initialize'>> = {}
): FirstRunBootstrapService {
  return {
    getState: vi.fn(overrides.getState ?? (() => ({ status: 'REQUIRED' }))),
    initialize: vi.fn(overrides.initialize ?? (async () => createInitializationResult()))
  } as unknown as FirstRunBootstrapService
}

type InitializedFirstRunBootstrapState = Extract<
  FirstRunBootstrapState,
  { readonly status: 'INITIALIZED' }
>

function createInitializedInternalState(): InitializedFirstRunBootstrapState {
  return {
    status: 'INITIALIZED',
    installation: {
      id: '11111111-1111-4111-8111-111111111111',
      deploymentName: 'Cameroon Pilot',
      timeZone: 'Africa/Douala',
      createdAt: '2026-07-29T12:34:56.789Z',
      updatedAt: '2026-07-29T12:34:56.789Z'
    }
  } as unknown as InitializedFirstRunBootstrapState
}

function createInitializationResult(): FirstRunInitializationResult {
  return {
    status: 'INITIALIZED',
    installation: createInitializedInternalState().installation,
    administrator: {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'Admin.User',
      displayName: 'Admin User',
      role: 'LOCAL_ADMIN',
      isActive: true,
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: '2026-07-29T12:34:56.789Z',
      updatedAt: '2026-07-29T12:34:56.789Z'
    },
    initialLocation: {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Central Church',
      locationType: 'CHURCH',
      village: 'Messa',
      subdivision: 'Yaounde I',
      region: 'Centre',
      directions: 'Opposite market gate.',
      isActive: true,
      createdBy: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-07-29T12:34:56.789Z',
      updatedBy: '22222222-2222-4222-8222-222222222222',
      updatedAt: '2026-07-29T12:34:56.789Z'
    },
    auditEvents: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        installationId: '11111111-1111-4111-8111-111111111111',
        userId: null,
        action: 'INSTALLATION_INITIALIZED',
        entityType: 'INSTALLATION',
        entityId: '11111111-1111-4111-8111-111111111111',
        occurredAt: '2026-07-29T12:34:56.789Z',
        metadata: { bootstrap: true }
      }
    ]
  } as unknown as FirstRunInitializationResult
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
