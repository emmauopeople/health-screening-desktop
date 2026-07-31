import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createAuthenticationFailure,
  createIpcSuccess,
  ipcChannels,
  type AuthLoginRequest,
  type PublicActiveAuthenticationSession
} from '@shared/ipc'

const loginRequest: AuthLoginRequest = {
  username: 'Admin.User',
  password: 'CurrentPassw0rd!'
}

const activeSession: PublicActiveAuthenticationSession = {
  status: 'ACTIVE',
  user: {
    username: 'Admin.User',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN'
  },
  idleExpiresAt: '2026-07-31T12:15:00.000Z' as never,
  absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
  revision: 2
}

describe('preload authentication API', () => {
  it('exposes only fixed auth methods as a frozen group', () => {
    const api = createHealthScreeningApi(vi.fn())

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
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.auth)).toBe(true)
    expect('invoke' in api.auth).toBe(false)
    expect('send' in api.auth).toBe(false)
    expect('channel' in api.auth).toBe(false)
  })

  it('uses exact fixed auth channels and validated requests', async () => {
    const invoke = vi.fn().mockResolvedValue(createIpcSuccess(activeSession))
    const api = createHealthScreeningApi(invoke)

    await expect(api.auth.getSession()).resolves.toEqual(createIpcSuccess(activeSession))
    await expect(api.auth.login(loginRequest)).resolves.toEqual(createIpcSuccess(activeSession))

    expect(invoke).toHaveBeenCalledWith(ipcChannels.auth.getSession, {})
    expect(invoke).toHaveBeenCalledWith(ipcChannels.auth.login, loginRequest)
    expect(invoke).not.toHaveBeenCalledWith('attacker:channel', loginRequest)
  })

  it('rejects invalid local auth requests before invoking main', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke)
    const descriptorTrapRequest = new Proxy(
      { ...loginRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(
      api.auth.login({ ...loginRequest, userId: 'secret' } as unknown as AuthLoginRequest)
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(api.auth.login(descriptorTrapRequest as AuthLoginRequest)).resolves.toEqual(
      createAuthenticationFailure('VALIDATION_FAILED')
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('maps malformed auth responses and invoke rejection to IPC_UNAVAILABLE', async () => {
    const malformedSuccessInvoke = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...activeSession,
        user: {
          ...activeSession.user,
          id: '22222222-2222-4222-8222-222222222222'
        }
      }
    })
    const malformedFailureInvoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'AUTH_LOCKED',
        message: 'C:\\secret\\raw error'
      }
    })
    const rejectedInvoke = vi.fn().mockRejectedValue(new Error('CurrentPassw0rd! C:\\secret'))

    await expect(
      createHealthScreeningApi(malformedSuccessInvoke).auth.getSession()
    ).resolves.toEqual(createAuthenticationFailure('IPC_UNAVAILABLE'))
    await expect(createHealthScreeningApi(malformedFailureInvoke).auth.lock()).resolves.toEqual(
      createAuthenticationFailure('IPC_UNAVAILABLE')
    )
    await expect(
      createHealthScreeningApi(rejectedInvoke).auth.login(loginRequest)
    ).resolves.toEqual(createAuthenticationFailure('IPC_UNAVAILABLE'))
  })

  it('validates session-changed events, hides Electron events, and unsubscribes idempotently', () => {
    let subscribedChannel = ''
    let subscribedListener: ((payload: unknown) => void) | undefined
    const removeSubscription = vi.fn()
    const subscribe = vi.fn((channel: string, listener: (payload: unknown) => void) => {
      subscribedChannel = channel
      subscribedListener = listener

      return removeSubscription
    })
    const api = createHealthScreeningApi(vi.fn(), subscribe)
    const listener = vi.fn()

    const unsubscribe = api.auth.onSessionChanged(listener)

    expect(subscribedChannel).toBe(ipcChannels.auth.sessionChanged)
    subscribedListener?.({
      ...activeSession,
      user: {
        ...activeSession.user,
        passwordHash: 'hash'
      }
    })
    subscribedListener?.(activeSession)

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(activeSession)
    expect(Object.isFrozen(listener.mock.calls[0]?.[0])).toBe(true)

    unsubscribe()
    unsubscribe()

    expect(removeSubscription).toHaveBeenCalledOnce()
  })
})
