import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels, type AppHealth, type AppInfo } from '@shared/ipc'

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
  database: 'not-configured',
  clinicalFeatures: 'not-implemented'
}

describe('preload API factory', () => {
  it('exposes only the fixed app methods', () => {
    const api = createHealthScreeningApi(vi.fn())

    expect(Object.keys(api)).toEqual(['app'])
    expect(Object.keys(api.app)).toEqual(['getInfo', 'getHealth'])
    expect('invoke' in api).toBe(false)
    expect('send' in api).toBe(false)
    expect('on' in api).toBe(false)
  })

  it('invokes app.getInfo over the exact fixed channel with an empty request', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validInfo))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual(createIpcSuccess(validInfo))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getInfo, {})
  })

  it('invokes app.getHealth over the exact fixed channel with an empty request', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validHealth))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getHealth()).resolves.toEqual(createIpcSuccess(validHealth))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getHealth, {})
  })

  it('ignores renderer-supplied arguments and never accepts a channel string', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(validInfo))
    const api = createHealthScreeningApi(invoke)

    await api.app.getInfo()

    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', {})
    expect(invoke).toHaveBeenCalledWith(ipcChannels.app.getInfo, {})
  })

  it('maps malformed envelopes to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...validInfo,
        userDataPath: 'C:\\secret'
      }
    })
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })

  it('maps malformed failure envelopes to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'C:\\secret\\raw error'
      }
    })
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getInfo()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })

  it('maps invoke rejection to IPC_UNAVAILABLE', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('raw electron error'))
    const api = createHealthScreeningApi(invoke)

    await expect(api.app.getHealth()).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_UNAVAILABLE',
        message: 'The desktop service is unavailable.'
      }
    })
  })
})
