import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { ApplicationInfoProvider } from '@main/app/application-info'
import {
  createAppIpcHandlers,
  type AppIpcHandlers,
  type IpcOperationalLogger
} from '@main/ipc/handlers/app-handlers'
import {
  ApplicationIpcRegistrationError,
  disposeApplicationIpcHandlers,
  disposeScreeningSessionIpcHandlers,
  registerApplicationIpcHandlers,
  registerScreeningSessionIpcHandlers,
  type ApplicationIpcHandlerDependencies,
  type ApplicationIpcMain
} from '@main/ipc/register-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { ipcChannels, type AppHealth, type AppInfo } from '@shared/ipc'
import type {
  FirstRunBootstrapService,
  LocalAuthenticationSessionService,
  PatientAcknowledgmentService,
  PatientDemographicAmendmentService,
  PatientRegistryService,
  ScreeningSessionService,
  ScreeningSessionWorkspaceContextService
} from '@main/application'

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

describe('application IPC handlers', () => {
  it('returns validated safe app metadata', async () => {
    const getInfo = vi.fn(() => validInfo)
    const handlers = createHandlers({ getInfo })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toEqual({
      ok: true,
      data: validInfo
    })
    expect(getInfo).toHaveBeenCalledOnce()
  })

  it('returns the exact shell health contract', async () => {
    const getHealth = vi.fn(() => validHealth)
    const handlers = createHandlers({ getHealth })

    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toEqual({
      ok: true,
      data: validHealth
    })
    expect(getHealth).toHaveBeenCalledOnce()
  })

  it('rejects malformed requests before execution', async () => {
    const getInfo = vi.fn(() => validInfo)
    const getHealth = vi.fn(() => validHealth)
    const handlers = createHandlers({ getInfo, getHealth })

    await expect(handlers.getInfo(createAllowedEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.'
      }
    })
    await expect(handlers.getHealth(createAllowedEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.'
      }
    })
    expect(getInfo).not.toHaveBeenCalled()
    expect(getHealth).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders before request parsing or execution', async () => {
    const getInfo = vi.fn(() => validInfo)
    const handlers = createHandlers({ getInfo })

    await expect(handlers.getInfo(createForbiddenEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_FORBIDDEN',
        message: 'This operation is unavailable from the current window.'
      }
    })
    expect(getInfo).not.toHaveBeenCalled()
  })

  it('maps thrown provider errors to safe internal failures', async () => {
    const logger = createLogger()
    const handlers = createHandlers({
      getInfo: () => {
        throw new Error('C:\\secret\\path')
      },
      getHealth: () => {
        throw new Error('hostname-secret')
      },
      logger
    })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The application could not complete the request.'
      }
    })
    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The application could not complete the request.'
      }
    })
    expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
  })

  it('maps invalid trusted output to safe internal failures', async () => {
    const handlers = createHandlers({
      getInfo: () => ({ ...validInfo, applicationVersion: '' }),
      getHealth: () => ({ ...validHealth, database: 'connected' })
    })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' }
    })
    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' }
    })
  })
})

describe('application IPC handler registration', () => {
  it('registers exactly the owned handlers and preserves unrelated handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())

    const dispose = registerApplicationIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handle).toHaveBeenCalledTimes(27)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
      'health-screening:auth:change-required-password',
      'health-screening:auth:get-session',
      'health-screening:auth:lock',
      'health-screening:auth:login',
      'health-screening:auth:logout',
      'health-screening:auth:record-activity',
      'health-screening:auth:unlock',
      'health-screening:first-run:get-state',
      'health-screening:first-run:initialize',
      'health-screening:patient:amend-demographics',
      'health-screening:patient:create',
      'health-screening:patient:find-duplicates',
      'health-screening:patient:get',
      'health-screening:patient:list-acknowledgment-history',
      'health-screening:patient:list-demographic-amendment-history',
      'health-screening:patient:list-recent',
      'health-screening:patient:mark-not-duplicate',
      'health-screening:patient:record-acknowledgment',
      'health-screening:patient:search',
      'health-screening:screening-sessions:close',
      'health-screening:screening-sessions:create',
      'health-screening:screening-sessions:get-by-id',
      'health-screening:screening-sessions:get-workspace-context',
      'health-screening:screening-sessions:list',
      'health-screening:screening-sessions:reopen',
      'unrelated:channel'
    ])

    dispose()

    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
  })

  it('re-registration removes only application-owned handlers before replacement', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())

    registerApplicationIpcHandlers(ipcMain, createDependencies())
    registerApplicationIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handle).toHaveBeenCalledTimes(54)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getInfo)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getHealth)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.firstRun.getState)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.firstRun.initialize)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
      'health-screening:auth:change-required-password',
      'health-screening:auth:get-session',
      'health-screening:auth:lock',
      'health-screening:auth:login',
      'health-screening:auth:logout',
      'health-screening:auth:record-activity',
      'health-screening:auth:unlock',
      'health-screening:first-run:get-state',
      'health-screening:first-run:initialize',
      'health-screening:patient:amend-demographics',
      'health-screening:patient:create',
      'health-screening:patient:find-duplicates',
      'health-screening:patient:get',
      'health-screening:patient:list-acknowledgment-history',
      'health-screening:patient:list-demographic-amendment-history',
      'health-screening:patient:list-recent',
      'health-screening:patient:mark-not-duplicate',
      'health-screening:patient:record-acknowledgment',
      'health-screening:patient:search',
      'health-screening:screening-sessions:close',
      'health-screening:screening-sessions:create',
      'health-screening:screening-sessions:get-by-id',
      'health-screening:screening-sessions:get-workspace-context',
      'health-screening:screening-sessions:list',
      'health-screening:screening-sessions:reopen',
      'unrelated:channel'
    ])
  })

  it('disposes only application-owned handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getHealth, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.getState, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.initialize, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.getSession, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.login, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.changeRequiredPassword, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.unlock, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.lock, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.logout, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.recordActivity, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.search, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.get, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.create, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.amendDemographics, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listDemographicAmendmentHistory, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.recordAcknowledgment, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listAcknowledgmentHistory, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listRecent, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.findDuplicates, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.markNotDuplicate, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.getWorkspaceContext, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.create, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.close, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.reopen, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.getById, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.list, vi.fn())

    disposeApplicationIpcHandlers(ipcMain)

    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
  })

  it('can register and dispose only screening-session handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.getState, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.login, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.search, vi.fn())

    const dispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )

    expect(ipcMain.handle).toHaveBeenCalledTimes(6)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.patient.search)).toBe(true)

    dispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:auth:login',
      'health-screening:first-run:get-state',
      'health-screening:patient:search'
    ])

    disposeScreeningSessionIpcHandlers(ipcMain)

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:auth:login',
      'health-screening:first-run:get-state',
      'health-screening:patient:search'
    ])

    registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(true)
  })

  it('rejects duplicate screening-session registration without replacing original handlers', () => {
    const ipcMain = createMockIpcMain()
    const dispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )
    const originalHandlers = new Map(ipcMain.handlers)

    expect(() =>
      registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)
    ).toThrow(ApplicationIpcRegistrationError)
    expect(ipcMain.handle).toHaveBeenCalledTimes(6)

    for (const [channel, handler] of originalHandlers) {
      expect(ipcMain.handlers.get(channel)).toBe(handler)
    }

    dispose()
  })

  it('cleans up only screening-session handlers installed by a failed partial registration', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.screeningSessions.reopen
    })
    const unrelatedHandler = vi.fn()
    const preexistingReopenHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)
    ipcMain.handlers.set(ipcChannels.screeningSessions.reopen, preexistingReopenHandler)

    let error: unknown

    try {
      registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ApplicationIpcRegistrationError)
    expect(String(error)).toBe(
      'ApplicationIpcRegistrationError: Application IPC handler registration failed.'
    )
    expect(String(error)).not.toContain('secret')
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
    expect(ipcMain.handlers.get(ipcChannels.screeningSessions.reopen)).toBe(
      preexistingReopenHandler
    )
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.getWorkspaceContext)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.close)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.getById)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.list)).toBe(false)
  })
})

interface HandlerTestOverrides {
  getInfo?: () => unknown
  getHealth?: () => unknown
  logger?: TestLogger
}

interface TestLogger extends IpcOperationalLogger {
  warn: IpcOperationalLogger['warn'] & {
    mock: {
      calls: unknown[][]
    }
  }
  error: IpcOperationalLogger['error'] & {
    mock: {
      calls: unknown[][]
    }
  }
}

function createHandlers(overrides: HandlerTestOverrides = {}): AppIpcHandlers {
  return createAppIpcHandlers({
    ...createDependencies(),
    ...overrides
  })
}

function createDependencies(): ApplicationIpcHandlerDependencies {
  return {
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    applicationInfoProvider: createApplicationInfoProvider(),
    databaseHealthProvider: { getStatus: () => 'ready' },
    firstRun: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      firstRunBootstrapService: createFirstRunBootstrapService(),
      logger: createLogger()
    },
    auth: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      sessionPublisher: {
        publish: vi.fn(() => true),
        dispose: vi.fn()
      },
      logger: createLogger()
    },
    patient: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      patientRegistryService: createPatientRegistryService(),
      patientDemographicAmendmentService: createPatientDemographicAmendmentService(),
      patientAcknowledgmentService: createPatientAcknowledgmentService(),
      logger: createLogger()
    },
    screeningSessions: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      screeningSessionService: createScreeningSessionService(),
      screeningSessionWorkspaceContextService: createScreeningSessionWorkspaceContextService(),
      logger: createLogger()
    },
    logger: createLogger()
  }
}

function createFirstRunBootstrapService(): FirstRunBootstrapService {
  return {
    getState: vi.fn(() => ({ status: 'REQUIRED' })),
    initialize: vi.fn()
  } as unknown as FirstRunBootstrapService
}

function createAuthenticationSessionService(): LocalAuthenticationSessionService {
  return {
    getSnapshot: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 0 })),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 0 })),
    logout: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 1 })),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn()
  } as unknown as LocalAuthenticationSessionService
}

function createPatientRegistryService(): PatientRegistryService {
  return {
    search: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listRecent: vi.fn(),
    findDuplicates: vi.fn(),
    markNotDuplicate: vi.fn()
  } as unknown as PatientRegistryService
}

function createPatientDemographicAmendmentService(): PatientDemographicAmendmentService {
  return {
    amend: vi.fn(),
    listHistory: vi.fn()
  } as unknown as PatientDemographicAmendmentService
}

function createPatientAcknowledgmentService(): PatientAcknowledgmentService {
  return {
    record: vi.fn(),
    listHistory: vi.fn()
  } as unknown as PatientAcknowledgmentService
}

function createScreeningSessionService(): ScreeningSessionService {
  return {
    create: vi.fn(),
    close: vi.fn(),
    reopen: vi.fn(),
    getById: vi.fn(),
    list: vi.fn()
  } as unknown as ScreeningSessionService
}

function createScreeningSessionWorkspaceContextService(): ScreeningSessionWorkspaceContextService {
  return {
    getContext: vi.fn()
  } as unknown as ScreeningSessionWorkspaceContextService
}

function createApplicationInfoProvider(): ApplicationInfoProvider {
  return {
    getVersion: () => validInfo.applicationVersion,
    getPlatform: () => validInfo.platform,
    getArchitecture: () => validInfo.architecture,
    isPackaged: () => validInfo.packaged
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

function createMockIpcMain({
  throwOnHandleChannel
}: {
  readonly throwOnHandleChannel?: string
} = {}): ApplicationIpcMain & {
  handlers: Map<string, unknown>
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, unknown>()

  return {
    handlers,
    handle: vi.fn((channel: string, listener: unknown) => {
      if (channel === throwOnHandleChannel) {
        throw new Error('secret duplicate handler failure')
      }

      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    })
  }
}
