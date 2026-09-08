import { describe, expect, it, vi } from 'vitest'

import type { AuditReportService } from '@main/application'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { AuditReportIpcHandlerDependencies } from '@main/ipc/handlers/audit-report-handlers'
import {
  ApplicationIpcRegistrationError,
  registerAuditReportIpcHandlers,
  type ApplicationIpcMain
} from '@main/ipc'
import { ipcChannels } from '@shared/ipc'

describe('audit report IPC registration', () => {
  it('registers and disposes only the two owned channels', () => {
    const ipcMain = createIpcMain()
    const unrelated = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelated)

    const dispose = registerAuditReportIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handlers.has(ipcChannels.auditReports.getContext)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.auditReports.search)).toBe(true)
    expect(() => registerAuditReportIpcHandlers(ipcMain, createDependencies())).toThrow(
      ApplicationIpcRegistrationError
    )

    dispose()
    expect([...ipcMain.handlers.entries()]).toEqual([['unrelated:channel', unrelated]])
    dispose()
  })

  it('rolls back the first channel when the second registration fails', () => {
    const ipcMain = createIpcMain(ipcChannels.auditReports.search)

    expect(() => registerAuditReportIpcHandlers(ipcMain, createDependencies())).toThrow(
      ApplicationIpcRegistrationError
    )
    expect(ipcMain.handlers.has(ipcChannels.auditReports.getContext)).toBe(false)

    ipcMain.throwOn = undefined
    const dispose = registerAuditReportIpcHandlers(ipcMain, createDependencies())
    expect(ipcMain.handlers.has(ipcChannels.auditReports.search)).toBe(true)
    dispose()
  })
})

function createDependencies(): AuditReportIpcHandlerDependencies {
  const auditReportService: AuditReportService = {
    getContext: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    search: vi.fn(() => ({ status: 'UNAVAILABLE' as const }))
  }
  return {
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    auditReportService,
    logger: { warn: vi.fn(), error: vi.fn() }
  }
}

function createIpcMain(throwOn?: string): ApplicationIpcMain & {
  readonly handlers: Map<string, (...args: never[]) => unknown>
  throwOn?: string
} {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipcMain = {
    handlers,
    throwOn,
    handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
      if (channel === ipcMain.throwOn) throw new Error('registration failure')
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    })
  }
  return ipcMain as ApplicationIpcMain & typeof ipcMain
}
