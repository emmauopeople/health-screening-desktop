import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { ApplicationInfoProvider } from '@main/app/application-info'
import {
  createAppIpcHandlers,
  type AppIpcHandlerDependencies,
  type AppIpcHandlers,
  type IpcOperationalLogger
} from '@main/ipc/handlers/app-handlers'
import {
  disposeApplicationIpcHandlers,
  registerApplicationIpcHandlers,
  type ApplicationIpcMain
} from '@main/ipc/register-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { ipcChannels, type AppHealth, type AppInfo } from '@shared/ipc'

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
  it('registers exactly the two application handlers and preserves unrelated handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())

    const dispose = registerApplicationIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handle).toHaveBeenCalledTimes(2)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
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

    expect(ipcMain.handle).toHaveBeenCalledTimes(4)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getInfo)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getHealth)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
      'unrelated:channel'
    ])
  })

  it('disposes only HSD-005 handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getHealth, vi.fn())

    disposeApplicationIpcHandlers(ipcMain)

    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
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

function createDependencies(): AppIpcHandlerDependencies {
  return {
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    applicationInfoProvider: createApplicationInfoProvider(),
    databaseHealthProvider: { getStatus: () => 'ready' },
    logger: createLogger()
  }
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

function createMockIpcMain(): ApplicationIpcMain & {
  handlers: Map<string, unknown>
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, unknown>()

  return {
    handlers,
    handle: vi.fn((channel: string, listener: unknown) => {
      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    })
  }
}
