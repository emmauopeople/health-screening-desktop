import { describe, expect, it, vi } from 'vitest'

import {
  createAuthenticationFailure,
  createIpcSuccess,
  type AuthRecordActivityResult,
  type HealthScreeningApi,
  type PublicActiveAuthenticationSession
} from '@shared/ipc'
import type { RendererAuthenticationRouteController } from '../../../src/renderer/src/app/authentication/authentication-route-controller'
import {
  authenticationActivityEventTypes,
  createAuthenticationActivityReporter,
  createAuthenticationDeadlineReconciler,
  getAuthenticationRouteDeadlineMs,
  type AuthenticationEventTarget,
  type AuthenticationVisibilityTarget
} from '../../../src/renderer/src/app/authentication/authentication-session-runtime'

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

describe('authentication session runtime', () => {
  it('registers only approved passive activity events and reports the first activity promptly', async () => {
    const target = new FakeEventTarget()
    const api = createApi({
      recordActivity: vi.fn(() =>
        Promise.resolve(createIpcSuccess(activeSession) as AuthRecordActivityResult)
      )
    })
    const controller = createController()
    const reporter = createAuthenticationActivityReporter({
      api,
      controller,
      eventTarget: target
    })

    expect(target.addedTypes()).toEqual(authenticationActivityEventTypes)
    expect(target.addOptions.every((options) => options?.passive === true)).toBe(true)
    expect(target.addedTypes()).not.toContain('mousemove')

    target.dispatch('pointerdown')

    expect(api.auth.recordActivity).toHaveBeenCalledOnce()

    await flushPromises()

    expect(controller.acceptSession).toHaveBeenCalledWith(activeSession)

    reporter.dispose()
    target.dispatch('keydown')

    expect(api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(target.removedTypes()).toEqual(authenticationActivityEventTypes)
  })

  it('throttles activity, coalesces trailing activity, and keeps one call in flight', async () => {
    let currentTime = 0
    const scheduler = createScheduler()
    const first = deferred<AuthRecordActivityResult>()
    const second = Promise.resolve(createIpcSuccess({ ...activeSession, revision: 5 }))
    const api = createApi({
      recordActivity: vi.fn()
    })
    api.auth.recordActivity.mockImplementationOnce(() => first.promise)
    api.auth.recordActivity.mockImplementationOnce(
      () => second as Promise<AuthRecordActivityResult>
    )
    const controller = createController()
    const target = new FakeEventTarget()

    createAuthenticationActivityReporter({
      api,
      controller,
      eventTarget: target,
      now: () => currentTime,
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout
    })

    target.dispatch('pointerdown')
    target.dispatch('wheel')

    expect(api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(scheduler.timers).toHaveLength(0)

    first.resolve(createIpcSuccess(activeSession) as AuthRecordActivityResult)
    await flushPromises()

    expect(scheduler.timers).toHaveLength(1)
    expect(scheduler.timers[0]?.delayMs).toBe(60_000)

    currentTime = 60_000
    scheduler.run(0)
    await flushPromises()

    expect(api.auth.recordActivity).toHaveBeenCalledTimes(2)
    expect(controller.acceptSession).toHaveBeenCalledWith(activeSession)
    expect(controller.acceptSession).toHaveBeenCalledWith({ ...activeSession, revision: 5 })
  })

  it('does not create repeated zero-delay trailing timers while a request remains in flight', () => {
    let currentTime = 0
    const scheduler = createScheduler()
    const first = deferred<AuthRecordActivityResult>()
    const api = createApi({
      recordActivity: vi.fn(() => first.promise)
    })
    const controller = createController()
    const target = new FakeEventTarget()

    createAuthenticationActivityReporter({
      api,
      controller,
      eventTarget: target,
      now: () => currentTime,
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout
    })

    target.dispatch('pointerdown')
    currentTime = 120_000

    for (const eventType of authenticationActivityEventTypes) {
      target.dispatch(eventType)
    }

    expect(api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(scheduler.timers).toHaveLength(0)
  })

  it('reconciles wrong-state activity failures without retrying IPC failures', async () => {
    const target = new FakeEventTarget()
    const controller = createController()
    const api = createApi({
      recordActivity: vi
        .fn()
        .mockResolvedValueOnce(
          createAuthenticationFailure('AUTH_LOCKED') as AuthRecordActivityResult
        )
        .mockResolvedValueOnce(
          createAuthenticationFailure('IPC_UNAVAILABLE') as AuthRecordActivityResult
        )
        .mockRejectedValueOnce(new Error('transport failed'))
    })

    createAuthenticationActivityReporter({
      api,
      controller,
      eventTarget: target,
      throttleMs: 0
    })

    target.dispatch('pointerdown')
    await flushPromises()
    target.dispatch('keydown')
    await flushPromises()
    target.dispatch('touchstart')
    await flushPromises()

    expect(api.auth.recordActivity).toHaveBeenCalledTimes(3)
    expect(controller.reconcile).toHaveBeenCalledOnce()
    expect(controller.acceptSession).not.toHaveBeenCalled()
  })

  it('fails closed on forbidden activity without retrying or reconciling', async () => {
    const target = new FakeEventTarget()
    const controller = createController()
    const api = createApi({
      recordActivity: vi.fn(() =>
        Promise.resolve(createAuthenticationFailure('IPC_FORBIDDEN') as AuthRecordActivityResult)
      )
    })

    createAuthenticationActivityReporter({
      api,
      controller,
      eventTarget: target
    })

    target.dispatch('pointerdown')
    await flushPromises()

    expect(api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(controller.showUnavailable).toHaveBeenCalledWith(true)
    expect(controller.reconcile).not.toHaveBeenCalled()
    expect(controller.acceptSession).not.toHaveBeenCalled()
  })

  it('selects the reviewed deadline and reconciles with one timeout plus focus visibility hooks', () => {
    const now = Date.parse('2026-07-31T12:00:00.000Z')
    const scheduler = createScheduler()
    const windowTarget = new FakeEventTarget()
    const documentTarget = new FakeVisibilityTarget()
    const controller = createController()

    expect(
      getAuthenticationRouteDeadlineMs({
        status: 'SESSION_ACTIVE',
        user: activeSession.user,
        idleExpiresAt: '2026-07-31T12:05:00.000Z' as never,
        absoluteExpiresAt: '2026-07-31T13:00:00.000Z' as never,
        revision: 7
      })
    ).toBe(Date.parse('2026-07-31T12:05:00.000Z'))
    expect(
      getAuthenticationRouteDeadlineMs({
        status: 'PASSWORD_CHANGE_REQUIRED',
        user: activeSession.user,
        expiresAt: '2026-07-31T12:10:00.000Z' as never,
        revision: 8
      })
    ).toBe(Date.parse('2026-07-31T12:10:00.000Z'))
    expect(getAuthenticationRouteDeadlineMs({ status: 'LOGIN_REQUIRED', revision: 9 })).toBeNull()

    const reconciler = createAuthenticationDeadlineReconciler({
      route: {
        status: 'SESSION_LOCKED',
        user: activeSession.user,
        reason: 'IDLE_TIMEOUT',
        absoluteExpiresAt: '2026-07-31T12:20:00.000Z' as never,
        revision: 10
      },
      controller,
      windowTarget,
      documentTarget,
      now: () => now,
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout
    })

    expect(scheduler.timers).toHaveLength(1)
    expect(scheduler.timers[0]?.delayMs).toBe(20 * 60_000)

    scheduler.run(0)
    windowTarget.dispatch('focus')
    documentTarget.visibilityState = 'hidden'
    documentTarget.dispatch('visibilitychange')
    documentTarget.visibilityState = 'visible'
    documentTarget.dispatch('visibilitychange')

    expect(controller.reconcile).toHaveBeenCalledTimes(3)

    reconciler.dispose()

    expect(scheduler.cleared).toHaveLength(1)
    expect(windowTarget.removedTypes()).toEqual(['focus'])
    expect(documentTarget.removedTypes()).toEqual(['visibilitychange'])
  })
})

function createApi({
  recordActivity = vi.fn(() =>
    Promise.resolve(createIpcSuccess(activeSession) as AuthRecordActivityResult)
  )
}: {
  recordActivity?: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['recordActivity']>>
} = {}): HealthScreeningApi & {
  auth: HealthScreeningApi['auth'] & {
    recordActivity: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['recordActivity']>>
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
      getSession: vi.fn(),
      login: vi.fn(),
      changeRequiredPassword: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(),
      logout: vi.fn(),
      recordActivity,
      onSessionChanged: vi.fn()
    }
  } as unknown as HealthScreeningApi & {
    auth: HealthScreeningApi['auth'] & {
      recordActivity: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['recordActivity']>>
    }
  }
}

function createController(): RendererAuthenticationRouteController & {
  reconcile: ReturnType<typeof vi.fn<RendererAuthenticationRouteController['reconcile']>>
  acceptSession: ReturnType<typeof vi.fn<RendererAuthenticationRouteController['acceptSession']>>
  showUnavailable: ReturnType<
    typeof vi.fn<RendererAuthenticationRouteController['showUnavailable']>
  >
} {
  return {
    load: vi.fn(),
    reconcile: vi.fn(() => Promise.resolve()),
    acceptSession: vi.fn(),
    showUnavailable: vi.fn(),
    dispose: vi.fn()
  }
}

class FakeEventTarget implements AuthenticationEventTarget {
  readonly listeners = new Map<string, EventListener[]>()
  readonly addOptions: Array<AddEventListenerOptions | undefined> = []
  readonly removeCalls: string[] = []

  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void {
    this.addOptions.push(options)
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.removeCalls.push(type)
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((registered) => registered !== listener)
    )
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type } as Event)
    }
  }

  addedTypes(): string[] {
    return Array.from(this.listeners.keys())
  }

  removedTypes(): string[] {
    return this.removeCalls
  }
}

class FakeVisibilityTarget extends FakeEventTarget implements AuthenticationVisibilityTarget {
  visibilityState = 'visible'
}

function createScheduler(): {
  timers: Array<{ callback: () => void; delayMs: number; canceled: boolean }>
  cleared: unknown[]
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
  run(index: number): void
} {
  const timers: Array<{ callback: () => void; delayMs: number; canceled: boolean }> = []
  const cleared: unknown[] = []

  return {
    timers,
    cleared,
    setTimeout(callback, delayMs) {
      const timer = { callback, delayMs, canceled: false }
      timers.push(timer)

      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(handle) {
      cleared.push(handle)
      const timer = handle as unknown as { canceled: boolean }
      timer.canceled = true
    },
    run(index) {
      const timer = timers[index]

      if (timer !== undefined && !timer.canceled) {
        timer.callback()
      }
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

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
