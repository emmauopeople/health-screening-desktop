import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError,
  type FirstRunBootstrapService
} from '@main/application'
import {
  createFirstRunIpcHandlers,
  type FirstRunIpcHandlers,
  type FirstRunIpcOperationalLogger
} from '@main/ipc/handlers/first-run-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createFirstRunFailure, type FirstRunInitializeRequest } from '@shared/ipc'

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

const unsafeFragments = [
  'ValidPassw0rd',
  'C:\\secret',
  'proxy-trap',
  'name-accessor',
  'SELECT',
  '11111111-1111-4111-8111-111111111111',
  '2026-07-29',
  'bootstrap'
] as const

describe('first-run IPC hostile error containment', () => {
  it('maps hostile proxy and revoked-proxy throws to INTERNAL_ERROR for both handlers', async () => {
    const hostileValues = [createThrowingPrototypeProxy(), createRevokedProxy()]

    for (const hostileValue of hostileValues) {
      const logger = createLogger()
      const handlers = createHandlers({
        logger,
        getState: () => {
          throw hostileValue
        },
        initialize: () => {
          throw hostileValue
        }
      })

      const stateResult = await handlers.getState(createAllowedEvent(), {})
      const initializeResult = await handlers.initialize(createAllowedEvent(), validRequest)

      expect(stateResult).toEqual(createFirstRunFailure('INTERNAL_ERROR'))
      expect(initializeResult).toEqual(createFirstRunFailure('INTERNAL_ERROR'))
      expectSafeResponseAndLogs([stateResult, initializeResult], logger)
    }
  })

  it('contains an Error with a throwing name accessor for both handlers', async () => {
    const hostileError = createThrowingNameError()
    const logger = createLogger()
    const handlers = createHandlers({
      logger,
      getState: () => {
        throw hostileError
      },
      initialize: () => {
        throw hostileError
      }
    })

    const stateResult = await handlers.getState(createAllowedEvent(), {})
    const initializeResult = await handlers.initialize(createAllowedEvent(), validRequest)

    expect(stateResult).toEqual(createFirstRunFailure('INTERNAL_ERROR'))
    expect(initializeResult).toEqual(createFirstRunFailure('INTERNAL_ERROR'))
    expectSafeResponseAndLogs([stateResult, initializeResult], logger)
  })

  it('keeps every controlled HSD-014 error mapping exact', async () => {
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

  it('does not let warning logger failure alter a forbidden response', async () => {
    const service = createService()
    const handlers = createHandlers({
      service,
      logger: {
        warn() {
          throw new Error('C:\\secret\\warn-logger.txt')
        },
        error: vi.fn()
      }
    })

    await expect(handlers.getState(createForbiddenEvent(), {})).resolves.toEqual(
      createFirstRunFailure('IPC_FORBIDDEN')
    )
    await expect(handlers.initialize(createForbiddenEvent(), validRequest)).resolves.toEqual(
      createFirstRunFailure('IPC_FORBIDDEN')
    )
    expect(service.getState).not.toHaveBeenCalled()
    expect(service.initialize).not.toHaveBeenCalled()
  })

  it('does not let error logger failure alter internal-error responses', async () => {
    const handlers = createHandlers({
      logger: {
        warn: vi.fn(),
        error() {
          throw new Error('C:\\secret\\error-logger.txt')
        }
      },
      getState: () => {
        throw new Error('C:\\secret\\state.txt')
      },
      initialize: () => {
        throw new Error('C:\\secret\\initialize.txt')
      }
    })

    await expect(handlers.getState(createAllowedEvent(), {})).resolves.toEqual(
      createFirstRunFailure('INTERNAL_ERROR')
    )
    await expect(handlers.initialize(createAllowedEvent(), validRequest)).resolves.toEqual(
      createFirstRunFailure('INTERNAL_ERROR')
    )
  })
})

interface HandlerOverrides {
  readonly service?: FirstRunBootstrapService
  readonly getState?: FirstRunBootstrapService['getState']
  readonly initialize?: FirstRunBootstrapService['initialize']
  readonly logger?: FirstRunIpcOperationalLogger
}

interface TestLogger extends FirstRunIpcOperationalLogger {
  readonly warn: FirstRunIpcOperationalLogger['warn'] & {
    readonly mock: { readonly calls: unknown[][] }
  }
  readonly error: FirstRunIpcOperationalLogger['error'] & {
    readonly mock: { readonly calls: unknown[][] }
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
    initialize: vi.fn(
      overrides.initialize ??
        (async () => {
          throw new Error('Initialization result is not required by this test.')
        })
    )
  } as unknown as FirstRunBootstrapService
}

function createThrowingPrototypeProxy(): unknown {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('C:\\secret\\proxy-trap.txt')
      }
    }
  )
}

function createRevokedProxy(): unknown {
  const revocable = Proxy.revocable({}, {})
  revocable.revoke()
  return revocable.proxy
}

function createThrowingNameError(): Error {
  const error = new Error('C:\\secret\\raw-message.txt')

  Object.defineProperty(error, 'name', {
    configurable: true,
    get() {
      throw new Error('C:\\secret\\name-accessor.txt')
    }
  })

  return error
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

function expectSafeResponseAndLogs(response: unknown, logger: TestLogger): void {
  const serializedResponse = JSON.stringify(response)
  const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

  expect(logs).toContain('errorType=UnknownError')

  for (const unsafeFragment of unsafeFragments) {
    expect(serializedResponse).not.toContain(unsafeFragment)
    expect(logs).not.toContain(unsafeFragment)
  }
}
