import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  LocalSessionAuthorizationError,
  type LocalAuthenticationSessionService,
  type SyncAdministrationService
} from '@main/application'
import { createSyncAdministrationIpcHandlers } from '@main/ipc/handlers/sync-administration-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createSyncAdministrationFailure } from '@shared/ipc'

const token = `chs_inst_v1_${'A'.repeat(43)}`
const configuredAt = '2026-09-04T12:00:00.000Z'

describe('synchronization administration IPC handlers', () => {
  it('authorizes administrators and returns only bounded public state', async () => {
    const harness = createHarness()
    await expect(harness.handlers.getState(allowedEvent(), {})).resolves.toEqual({
      ok: true,
      data: {
        status: 'READY',
        configuration: { status: 'NOT_CONFIGURED' },
        activity: {
          state: 'NOT_CONFIGURED',
          pendingChangeCount: 3,
          pendingAcknowledgmentCount: 0,
          lastSuccessfulSyncAt: null,
          nextRetryAt: null
        }
      }
    })
    await expect(
      harness.handlers.configure(allowedEvent(), {
        apiBaseUrl: 'https://sync.example.org',
        installationToken: token
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'CONFIGURED',
        configuration: { tokenPrefix: token.slice(0, 20) }
      }
    })
    expect(harness.service.configure).toHaveBeenCalledWith({
      apiBaseUrl: 'https://sync.example.org',
      installationToken: token
    })
  })

  it('rejects untrusted senders and unauthorized users before inspecting credentials', async () => {
    for (const harness of [createHarness(), createHarness(new LocalSessionAuthorizationError())]) {
      let inspected = false
      const request = new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            inspected = true
            throw new Error('secret token')
          }
        }
      )
      const result = await harness.handlers.configure(
        harness.authError === undefined ? forbiddenEvent() : allowedEvent(),
        request
      )
      expect(result).toEqual(
        createSyncAdministrationFailure(
          harness.authError === undefined ? 'IPC_FORBIDDEN' : 'AUTHORIZATION_FAILED'
        )
      )
      expect(inspected).toBe(false)
      expect(harness.service.configure).not.toHaveBeenCalled()
    }
  })

  it('strictly validates configuration and maps secure-storage failure safely', async () => {
    const harness = createHarness()
    for (const request of [
      {},
      { apiBaseUrl: 'https://sync.example.org', installationToken: 'secret' },
      { apiBaseUrl: 'https://sync.example.org', installationToken: token, role: 'LOCAL_ADMIN' }
    ]) {
      await expect(harness.handlers.configure(allowedEvent(), request)).resolves.toEqual(
        createSyncAdministrationFailure('VALIDATION_FAILED')
      )
    }
    harness.service.configure.mockReturnValueOnce({ status: 'PROTECTION_UNAVAILABLE' })
    await expect(
      harness.handlers.configure(allowedEvent(), {
        apiBaseUrl: 'https://sync.example.org',
        installationToken: token
      })
    ).resolves.toEqual(createSyncAdministrationFailure('PROTECTION_UNAVAILABLE'))
  })
})

function createHarness(authError?: Error): {
  readonly authError: Error | undefined
  readonly service: SyncAdministrationService & {
    getState: ReturnType<typeof vi.fn>
    configure: ReturnType<typeof vi.fn>
  }
  readonly handlers: ReturnType<typeof createSyncAdministrationIpcHandlers>
} {
  const requireAnyRole = vi.fn(() => {
    if (authError !== undefined) throw authError
    return { user: { id: '10000000-0000-4000-8000-000000000001', role: 'LOCAL_ADMIN' } }
  })
  const authenticationSessionService = {
    requireAnyRole
  } as unknown as LocalAuthenticationSessionService
  const service = {
    getState: vi.fn(() => ({
      status: 'READY' as const,
      configuration: { status: 'NOT_CONFIGURED' as const },
      activity: {
        state: 'NOT_CONFIGURED' as const,
        pendingChangeCount: 3,
        pendingAcknowledgmentCount: 0,
        lastSuccessfulSyncAt: null,
        nextRetryAt: null
      }
    })),
    configure: vi.fn(() => ({
      status: 'CONFIGURED' as const,
      configuration: {
        status: 'CONFIGURED' as const,
        apiBaseUrl: 'https://sync.example.org',
        tokenPrefix: token.slice(0, 20),
        updatedAt: configuredAt as never
      }
    }))
  } as unknown as SyncAdministrationService & {
    getState: ReturnType<typeof vi.fn>
    configure: ReturnType<typeof vi.fn>
  }
  return {
    authError,
    service,
    handlers: createSyncAdministrationIpcHandlers({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService,
      syncAdministrationService: service,
      logger: { warn: vi.fn(), error: vi.fn() }
    })
  }
}

function allowedEvent(): IpcSenderValidationEvent {
  return event('http://localhost:5173/')
}

function forbiddenEvent(): IpcSenderValidationEvent {
  return event('https://example.invalid/')
}

function event(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }
  return { sender: { mainFrame }, senderFrame: mainFrame }
}
