import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createFirstRunFailure,
  createIpcSuccess,
  createPatientFailure,
  ipcChannels,
  type AppHealth,
  type AppInfo,
  type FirstRunInitializeRequest
} from '@shared/ipc'

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

const validFirstRunRequest: FirstRunInitializeRequest = {
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

describe('preload API factory', () => {
  it('exposes only the fixed app and first-run methods as frozen groups', () => {
    const api = createHealthScreeningApi(vi.fn())

    expect(Object.keys(api)).toEqual(['app', 'firstRun', 'auth', 'patient'])
    expect(Object.keys(api.app)).toEqual(['getInfo', 'getHealth'])
    expect(Object.keys(api.firstRun)).toEqual(['getState', 'initialize'])
    expect(Object.keys(api.auth)).toEqual([
      'getSession',
      'login',
      'changeRequiredPassword',
      'unlock',
      'lock',
      'logout',
      'recordActivity',
      'onSessionChanged'
    ])
    expect(Object.keys(api.patient)).toEqual([
      'search',
      'get',
      'create',
      'update',
      'listRecent',
      'findDuplicates',
      'markNotDuplicate'
    ])
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.app)).toBe(true)
    expect(Object.isFrozen(api.firstRun)).toBe(true)
    expect(Object.isFrozen(api.auth)).toBe(true)
    expect(Object.isFrozen(api.patient)).toBe(true)
    expect('invoke' in api).toBe(false)
    expect('send' in api).toBe(false)
    expect('on' in api).toBe(false)
    expect('once' in api).toBe(false)
    expect('removeListener' in api).toBe(false)
    expect('ipcRenderer' in api).toBe(false)
    expect('channel' in api.firstRun).toBe(false)
    expect('channel' in api.auth).toBe(false)
    expect('channel' in api.patient).toBe(false)
  })

  it('invokes patient.search over the exact fixed channel with a parsed request', async () => {
    const searchResult = {
      items: [],
      page: 1,
      pageSize: 25 as const,
      total: 0
    }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(searchResult))
    const api = createHealthScreeningApi(invoke)

    await expect(api.patient.search({ query: 'Ada', page: 1, pageSize: 25 })).resolves.toEqual(
      createIpcSuccess(searchResult)
    )
    expect(invoke).toHaveBeenCalledWith(ipcChannels.patient.search, {
      query: 'Ada',
      page: 1,
      pageSize: 25
    })
  })

  it('returns VALIDATION_FAILED for invalid local patient input without invoking IPC', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke)

    await expect(api.patient.search({ query: 'Ada', page: 0, pageSize: 25 })).resolves.toEqual(
      createPatientFailure('VALIDATION_FAILED')
    )
    expect(invoke).not.toHaveBeenCalled()
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

  it('invokes firstRun.getState over the exact fixed channel with an empty request', async () => {
    const state = { status: 'REQUIRED' as const }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(state))
    const api = createHealthScreeningApi(invoke)

    await expect(api.firstRun.getState()).resolves.toEqual(createIpcSuccess(state))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.firstRun.getState, {})
  })

  it('invokes firstRun.initialize over the exact fixed channel with a parsed command', async () => {
    const initialized = {
      status: 'INITIALIZED' as const,
      deploymentName: 'Cameroon Pilot',
      timeZone: 'Africa/Douala'
    }
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(initialized))
    const api = createHealthScreeningApi(invoke)

    await expect(api.firstRun.initialize(validFirstRunRequest)).resolves.toEqual(
      createIpcSuccess(initialized)
    )
    expect(invoke).toHaveBeenCalledWith(ipcChannels.firstRun.initialize, validFirstRunRequest)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', validFirstRunRequest)
  })

  it('returns VALIDATION_FAILED for invalid local first-run input without invoking IPC', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke)
    const descriptorTrapRequest = new Proxy(
      { ...validFirstRunRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(
      api.firstRun.initialize({
        ...validFirstRunRequest,
        initialLocation: { ...validFirstRunRequest.initialLocation, village: undefined }
      } as unknown as FirstRunInitializeRequest)
    ).resolves.toEqual(createFirstRunFailure('VALIDATION_FAILED'))
    await expect(
      api.firstRun.initialize(descriptorTrapRequest as unknown as FirstRunInitializeRequest)
    ).resolves.toEqual(createFirstRunFailure('VALIDATION_FAILED'))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('maps malformed first-run envelopes and invoke rejection to IPC_UNAVAILABLE', async () => {
    const malformedSuccessInvoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        status: 'INITIALIZED',
        deploymentName: 'Cameroon Pilot',
        timeZone: 'Africa/Douala',
        id: '11111111-1111-4111-8111-111111111111'
      }
    })
    const malformedFailureInvoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'FIRST_RUN_INITIALIZATION_FAILED',
        message: 'C:\\secret\\raw error'
      }
    })
    const rejectedInvoke = vi.fn().mockRejectedValue(new Error('raw electron error'))

    await expect(
      createHealthScreeningApi(malformedSuccessInvoke).firstRun.getState()
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    await expect(
      createHealthScreeningApi(malformedFailureInvoke).firstRun.initialize(validFirstRunRequest)
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    await expect(
      createHealthScreeningApi(rejectedInvoke).firstRun.initialize(validFirstRunRequest)
    ).resolves.toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
  })

  it('does not expose password or raw error values in serialized first-run failures', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('ValidPassw0rd! C:\\secret\\raw error'))
    const api = createHealthScreeningApi(invoke)
    const result = await api.firstRun.initialize(validFirstRunRequest)
    const serialized = JSON.stringify(result)

    expect(result).toEqual(createFirstRunFailure('IPC_UNAVAILABLE'))
    expect(serialized).not.toContain('ValidPassw0rd')
    expect(serialized).not.toContain('raw error')
    expect(serialized).not.toContain('C:\\')
  })
})
