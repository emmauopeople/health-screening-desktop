import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, createSyncAdministrationFailure, ipcChannels } from '@shared/ipc'

const token = `chs_inst_v1_${'A'.repeat(43)}`

describe('synchronization administration preload API', () => {
  it('uses fixed channels and validates both request and response', async () => {
    const invoke = vi.fn(async (channel: string) =>
      channel === ipcChannels.syncAdministration.getState
        ? createIpcSuccess({
            status: 'READY' as const,
            configuration: { status: 'NOT_CONFIGURED' as const },
            activity: {
              state: 'NOT_CONFIGURED' as const,
              pendingChangeCount: 2,
              pendingAcknowledgmentCount: 0,
              lastSuccessfulSyncAt: null,
              nextRetryAt: null
            }
          })
        : createIpcSuccess({
            status: 'CONFIGURED' as const,
            configuration: {
              status: 'CONFIGURED' as const,
              apiBaseUrl: 'https://sync.example.org',
              tokenPrefix: token.slice(0, 20),
              updatedAt: '2026-09-04T12:00:00.000Z'
            }
          })
    )
    const api = createHealthScreeningApi(invoke)
    await expect(api.syncAdministration.getState()).resolves.toMatchObject({
      ok: true,
      data: { activity: { pendingChangeCount: 2 } }
    })
    await expect(
      api.syncAdministration.configure({
        apiBaseUrl: 'https://sync.example.org',
        installationToken: token
      })
    ).resolves.toMatchObject({ ok: true, data: { status: 'CONFIGURED' } })
    expect(invoke).toHaveBeenNthCalledWith(1, ipcChannels.syncAdministration.getState, {})
    expect(invoke).toHaveBeenNthCalledWith(2, ipcChannels.syncAdministration.configure, {
      apiBaseUrl: 'https://sync.example.org',
      installationToken: token
    })
  })

  it('fails closed before IPC for malformed input and after malformed or rejected responses', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: { status: 'READY', token } }))
    const api = createHealthScreeningApi(invoke)
    await expect(
      api.syncAdministration.configure({
        apiBaseUrl: 'https://sync.example.org',
        installationToken: 'secret'
      })
    ).resolves.toEqual(createSyncAdministrationFailure('VALIDATION_FAILED'))
    expect(invoke).not.toHaveBeenCalled()
    await expect(api.syncAdministration.getState()).resolves.toEqual(
      createSyncAdministrationFailure('IPC_UNAVAILABLE')
    )
    const rejected = createHealthScreeningApi(vi.fn(async () => Promise.reject(new Error(token))))
    await expect(rejected.syncAdministration.getState()).resolves.toEqual(
      createSyncAdministrationFailure('IPC_UNAVAILABLE')
    )
  })
})
