import { describe, expect, it, vi } from 'vitest'

import {
  createAuthenticationFailure,
  createIpcSuccess,
  type AuthGetSessionResult,
  type HealthScreeningApi,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession
} from '@shared/ipc'
import {
  createRendererAuthenticationRouteController,
  mapPublicAuthenticationSessionToRoute
} from '../../../src/renderer/src/app/authentication/authentication-route-controller'
import type { RendererAuthenticationRoute } from '../../../src/renderer/src/app/authentication/authentication-route-types'

const signedOutSession: PublicAuthenticationSession = {
  status: 'SIGNED_OUT',
  revision: 1
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
  revision: 4
}

const lockedSession: PublicAuthenticationSession = {
  status: 'LOCKED',
  user: activeSession.user,
  reason: 'MANUAL',
  absoluteExpiresAt: activeSession.absoluteExpiresAt,
  revision: 5
}

const passwordChangeSession: PublicAuthenticationSession = {
  status: 'PASSWORD_CHANGE_REQUIRED',
  user: activeSession.user,
  expiresAt: '2026-07-31T12:15:00.000Z' as never,
  revision: 6
}

describe('renderer authentication route controller', () => {
  it('maps each public session state to the reviewed route state', () => {
    expect(mapPublicAuthenticationSessionToRoute(signedOutSession)).toEqual({
      status: 'LOGIN_REQUIRED',
      revision: 1
    })
    expect(
      mapPublicAuthenticationSessionToRoute({
        status: 'PASSWORD_CHANGE_REQUIRED',
        user: activeSession.user,
        expiresAt: '2026-07-31T12:15:00.000Z' as never,
        revision: 2
      })
    ).toEqual({
      status: 'PASSWORD_CHANGE_REQUIRED',
      user: activeSession.user,
      expiresAt: '2026-07-31T12:15:00.000Z',
      revision: 2
    })
    expect(mapPublicAuthenticationSessionToRoute(activeSession)).toEqual({
      status: 'SESSION_ACTIVE',
      user: activeSession.user,
      idleExpiresAt: activeSession.idleExpiresAt,
      absoluteExpiresAt: activeSession.absoluteExpiresAt,
      revision: activeSession.revision
    })
    expect(
      mapPublicAuthenticationSessionToRoute({
        status: 'LOCKED',
        user: activeSession.user,
        reason: 'MANUAL',
        absoluteExpiresAt: activeSession.absoluteExpiresAt,
        revision: 5
      })
    ).toMatchObject({ status: 'SESSION_LOCKED', reason: 'MANUAL', revision: 5 })
  })

  it('loads once per generation, subscribes, and maps failures to AUTH_UNAVAILABLE', async () => {
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: createIpcSuccess(signedOutSession) as AuthGetSessionResult
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    await controller.load()

    expect(api.auth.getSession).toHaveBeenCalledOnce()
    expect(api.auth.onSessionChanged).toHaveBeenCalledOnce()
    expect(states).toEqual([{ status: 'AUTH_LOADING' }, { status: 'LOGIN_REQUIRED', revision: 1 }])

    const unavailableStates: RendererAuthenticationRoute[] = []
    const unavailableController = createRendererAuthenticationRouteController({
      api: createApi({
        getSessionResult: createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult
      }),
      onRoute: (state) => unavailableStates.push(state)
    })

    await unavailableController.load()

    expect(unavailableStates).toEqual([
      { status: 'AUTH_LOADING' },
      {
        status: 'AUTH_UNAVAILABLE',
        message: 'Authentication is unavailable from the current window.',
        retryable: false
      }
    ])
  })

  it('preserves an active event when getSession later returns a failure envelope', async () => {
    const result = deferred<AuthGetSessionResult>()
    const states: RendererAuthenticationRoute[] = []
    let listener: ((session: PublicAuthenticationSession) => void) | undefined
    const api = createApi({
      getSessionResult: () => result.promise,
      onSessionChanged: (sessionListener) => {
        listener = sessionListener

        return vi.fn()
      }
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    const load = controller.load()
    listener?.(activeSession)
    result.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
    await load

    expect(states).toEqual([
      { status: 'AUTH_LOADING' },
      {
        status: 'SESSION_ACTIVE',
        user: activeSession.user,
        idleExpiresAt: activeSession.idleExpiresAt,
        absoluteExpiresAt: activeSession.absoluteExpiresAt,
        revision: activeSession.revision
      }
    ])
  })

  it('preserves a locked event when getSession later throws', async () => {
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: () => {
        throw new Error('IPC unavailable')
      },
      onSessionChanged: (listener) => {
        listener(lockedSession)

        return vi.fn()
      }
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    await controller.load()

    expect(states).toEqual([
      { status: 'AUTH_LOADING' },
      {
        status: 'SESSION_LOCKED',
        user: lockedSession.user,
        reason: 'MANUAL',
        absoluteExpiresAt: lockedSession.absoluteExpiresAt,
        revision: lockedSession.revision
      }
    ])
  })

  it('emits unavailable when getSession fails before any valid session event', async () => {
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    await controller.load()

    expect(states).toEqual([
      { status: 'AUTH_LOADING' },
      {
        status: 'AUTH_UNAVAILABLE',
        message: 'The desktop service could not provide local session status.',
        retryable: true
      }
    ])
  })

  it('accepts direct session observations and reconciles without duplicate loading states', async () => {
    let session: PublicAuthenticationSession = signedOutSession
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: () => Promise.resolve(createIpcSuccess(session) as AuthGetSessionResult)
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    controller.acceptSession(signedOutSession)
    controller.acceptSession(signedOutSession)
    controller.acceptSession({ ...activeSession, revision: 4 })

    session = { ...activeSession, revision: 4 }
    await controller.reconcile()

    session = lockedSession
    await controller.reconcile()

    expect(states).toEqual([
      { status: 'LOGIN_REQUIRED', revision: 1 },
      {
        status: 'SESSION_ACTIVE',
        user: activeSession.user,
        idleExpiresAt: activeSession.idleExpiresAt,
        absoluteExpiresAt: activeSession.absoluteExpiresAt,
        revision: 4
      },
      {
        status: 'SESSION_LOCKED',
        user: lockedSession.user,
        reason: 'MANUAL',
        absoluteExpiresAt: lockedSession.absoluteExpiresAt,
        revision: 5
      }
    ])
  })

  it('keeps the latest valid route when reconcile later fails or throws', async () => {
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: () =>
        Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    controller.acceptSession(activeSession)
    await controller.reconcile()

    api.auth.getSession.mockImplementationOnce(() => {
      throw new Error('unavailable')
    })

    await controller.reconcile()

    expect(states).toEqual([
      {
        status: 'SESSION_ACTIVE',
        user: activeSession.user,
        idleExpiresAt: activeSession.idleExpiresAt,
        absoluteExpiresAt: activeSession.absoluteExpiresAt,
        revision: activeSession.revision
      }
    ])
  })

  it.each([
    ['ACTIVE', activeSession],
    ['LOCKED', lockedSession],
    ['PASSWORD_CHANGE_REQUIRED', passwordChangeSession]
  ])('fails closed when %s reconciliation returns IPC_FORBIDDEN', async (_label, session) => {
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    controller.acceptSession(session)
    await controller.reconcile()

    expect(states).toEqual([
      mapPublicAuthenticationSessionToRoute(session),
      {
        status: 'AUTH_UNAVAILABLE',
        message: 'Authentication is unavailable from the current window.',
        retryable: false
      }
    ])
  })

  it('can move a previously valid route to forbidden unavailable without a retry action', () => {
    const states: RendererAuthenticationRoute[] = []
    const controller = createRendererAuthenticationRouteController({
      api: createApi(),
      onRoute: (state) => states.push(state)
    })

    controller.acceptSession(activeSession)
    controller.showUnavailable(true)

    expect(states).toEqual([
      {
        status: 'SESSION_ACTIVE',
        user: activeSession.user,
        idleExpiresAt: activeSession.idleExpiresAt,
        absoluteExpiresAt: activeSession.absoluteExpiresAt,
        revision: activeSession.revision
      },
      {
        status: 'AUTH_UNAVAILABLE',
        message: 'Authentication is unavailable from the current window.',
        retryable: false
      }
    ])
  })

  it('ignores stale load results, stale events, and disposed callbacks', async () => {
    const first = deferred<AuthGetSessionResult>()
    const second = deferred<AuthGetSessionResult>()
    const listeners: Array<(session: PublicAuthenticationSession) => void> = []
    const unsubscribes = [vi.fn(), vi.fn()]
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: () => {
        if (api.auth.getSession.mock.calls.length === 1) {
          return first.promise
        }

        return second.promise
      },
      onSessionChanged: (listener) => {
        listeners.push(listener)
        return unsubscribes[listeners.length - 1] ?? vi.fn()
      }
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    const firstLoad = controller.load()
    const secondLoad = controller.load()

    listeners[1]?.({ ...activeSession, revision: 6 })
    second.resolve(createIpcSuccess({ ...activeSession, revision: 5 }) as AuthGetSessionResult)
    await secondLoad

    first.resolve(createIpcSuccess(signedOutSession) as AuthGetSessionResult)
    await firstLoad

    expect(states[states.length - 1]).toMatchObject({ status: 'SESSION_ACTIVE', revision: 6 })
    expect(unsubscribes[0]).toHaveBeenCalledOnce()

    listeners[1]?.({ ...activeSession, revision: 5 })
    expect(states[states.length - 1]).toMatchObject({ status: 'SESSION_ACTIVE', revision: 6 })

    controller.dispose()
    listeners[1]?.({ status: 'SIGNED_OUT', revision: 7 })
    expect(states[states.length - 1]).toMatchObject({ status: 'SESSION_ACTIVE', revision: 6 })
    expect(unsubscribes[1]).toHaveBeenCalledOnce()
  })

  it('does not let stale pending loads, reconciliations, or events restore forbidden unavailable', async () => {
    const pendingLoad = deferred<AuthGetSessionResult>()
    const pendingReconcile = deferred<AuthGetSessionResult>()
    const listeners: Array<(session: PublicAuthenticationSession) => void> = []
    const unsubscribes = [vi.fn()]
    const states: RendererAuthenticationRoute[] = []
    const api = createApi({
      getSessionResult: () => {
        if (api.auth.getSession.mock.calls.length === 1) {
          return pendingLoad.promise
        }

        return pendingReconcile.promise
      },
      onSessionChanged: (listener) => {
        listeners.push(listener)
        return unsubscribes[listeners.length - 1] ?? vi.fn()
      }
    })
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (state) => states.push(state)
    })

    const load = controller.load()
    controller.showUnavailable(true)
    listeners[0]?.({ ...activeSession, revision: 7 })
    pendingLoad.resolve(createIpcSuccess({ ...activeSession, revision: 8 }) as AuthGetSessionResult)
    await load

    expect(states[states.length - 1]).toEqual({
      status: 'AUTH_UNAVAILABLE',
      message: 'Authentication is unavailable from the current window.',
      retryable: false
    })
    expect(unsubscribes[0]).toHaveBeenCalledOnce()

    controller.acceptSession(activeSession)

    const reconcile = controller.reconcile()
    controller.showUnavailable(true)
    pendingReconcile.resolve(
      createIpcSuccess({ ...activeSession, revision: 9 }) as AuthGetSessionResult
    )
    await reconcile
    listeners[0]?.({ ...activeSession, revision: 10 })

    expect(states[states.length - 1]).toEqual({
      status: 'AUTH_UNAVAILABLE',
      message: 'Authentication is unavailable from the current window.',
      retryable: false
    })
    expect(states).not.toContainEqual(expect.objectContaining({ revision: 7 }))
    expect(states).not.toContainEqual(expect.objectContaining({ revision: 8 }))
    expect(states).not.toContainEqual(expect.objectContaining({ revision: 9 }))
    expect(states).not.toContainEqual(expect.objectContaining({ revision: 10 }))
  })
})

function createApi({
  getSessionResult = createIpcSuccess(signedOutSession) as AuthGetSessionResult,
  onSessionChanged = () => () => undefined
}: {
  getSessionResult?: AuthGetSessionResult | (() => Promise<AuthGetSessionResult>)
  onSessionChanged?: (listener: (session: PublicAuthenticationSession) => void) => () => void
} = {}): HealthScreeningApi & {
  auth: HealthScreeningApi['auth'] & {
    getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
    onSessionChanged: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['onSessionChanged']>>
  }
} {
  return {
    app: {
      getInfo: vi.fn(),
      getHealth: vi.fn()
    },
    firstRun: {
      getState: vi.fn(),
      initialize: vi.fn()
    },
    auth: {
      getSession: vi.fn(() => {
        if (typeof getSessionResult === 'function') {
          return getSessionResult()
        }

        return Promise.resolve(getSessionResult)
      }),
      login: vi.fn(),
      changeRequiredPassword: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(),
      logout: vi.fn(),
      recordActivity: vi.fn(),
      onSessionChanged: vi.fn((listener) => onSessionChanged(listener))
    }
  } as unknown as HealthScreeningApi & {
    auth: HealthScreeningApi['auth'] & {
      getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
      onSessionChanged: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['onSessionChanged']>>
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return {
    promise,
    resolve(value: T) {
      if (resolveValue === undefined) {
        throw new Error('Deferred promise resolver is unavailable.')
      }

      resolveValue(value)
    }
  }
}
