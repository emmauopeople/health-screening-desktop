// @vitest-environment jsdom
/// <reference lib="dom" />

import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAuthenticationFailure,
  createIpcSuccess,
  type AuthChangeRequiredPasswordResult,
  type AuthGetSessionResult,
  type AuthLockResult,
  type AuthLoginResult,
  type AuthLogoutResult,
  type AuthRecordActivityResult,
  type AuthenticationSessionChangedListener,
  type AuthUnlockResult,
  type FirstRunGetStateResult,
  type HealthScreeningApi,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession,
  type PublicAuthenticatedUser,
  type PublicLockedAuthenticationSession,
  type PublicPasswordChangeRequiredAuthenticationSession,
  type PublicSignedOutAuthenticationSession,
  type UtcTimestamp
} from '@shared/ipc'
import App from '../../../src/renderer/src/app/App'

declare global {
  interface Window {
    healthScreening: HealthScreeningApi
  }
}

const baseUser: PublicAuthenticatedUser = {
  username: 'Admin.User',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN'
}

describe('renderer authentication DOM integration', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('moves from SIGNED_OUT through login to the ACTIVE shell from a direct success result', async () => {
    const harness = createAppApi(signedOutSession(1))
    harness.api.auth.login.mockResolvedValue(createIpcSuccess(activeSession(2)) as AuthLoginResult)
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Login')

    await submitLogin(mounted, ' Admin.User ', '  ValidPassword1!  ')

    expect(harness.api.auth.login).toHaveBeenCalledWith({
      username: ' Admin.User ',
      password: '  ValidPassword1!  '
    })
    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain('Admin User')

    await mounted.unmount()
  })

  it('keeps unavailable account recovery controlled in the renderer', async () => {
    const harness = createAppApi(signedOutSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Forgot username or password?')

    expect(text(mounted)).toContain(
      'Username and password recovery is not available in this build. Contact an authorized administrator.'
    )
    expect(harness.api.auth.login).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('uses route-aware root wrappers for authentication screens and the active shell', async () => {
    const pendingSession = deferred<AuthGetSessionResult>()
    const cases: Array<{
      readonly name: string
      readonly initialSession: PublicAuthenticationSession
      readonly expectedClassName: string
      readonly visibleText: string
      readonly hasRetry: boolean
      configure?(harness: AppApiHarness): void
    }> = [
      {
        name: 'AUTH_LOADING',
        initialSession: signedOutSession(1),
        expectedClassName: 'foundation-shell setup-shell',
        visibleText: 'Checking local session.',
        hasRetry: false,
        configure(harness) {
          harness.setGetSession(() => pendingSession.promise)
        }
      },
      {
        name: 'LOGIN_REQUIRED',
        initialSession: signedOutSession(2),
        expectedClassName: 'auth-login-root',
        visibleText: 'Login',
        hasRetry: false
      },
      {
        name: 'PASSWORD_CHANGE_REQUIRED',
        initialSession: passwordChangeSession(3),
        expectedClassName: 'foundation-shell setup-shell',
        visibleText: 'Change required password.',
        hasRetry: false
      },
      {
        name: 'SESSION_LOCKED',
        initialSession: lockedSession(4),
        expectedClassName: 'foundation-shell setup-shell',
        visibleText: 'Session locked.',
        hasRetry: false
      },
      {
        name: 'retryable AUTH_UNAVAILABLE',
        initialSession: signedOutSession(5),
        expectedClassName: 'foundation-shell setup-shell',
        visibleText: 'Authentication is unavailable.',
        hasRetry: true,
        configure(harness) {
          harness.setGetSession(() =>
            Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
          )
        }
      },
      {
        name: 'forbidden AUTH_UNAVAILABLE',
        initialSession: signedOutSession(6),
        expectedClassName: 'foundation-shell setup-shell',
        visibleText: 'Authentication is unavailable from the current window.',
        hasRetry: false,
        configure(harness) {
          harness.setGetSession(() =>
            Promise.resolve(createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult)
          )
        }
      },
      {
        name: 'SESSION_ACTIVE',
        initialSession: activeSession(7),
        expectedClassName: 'application-root',
        visibleText: 'Welcome, Admin User',
        hasRetry: false
      }
    ]

    for (const testCase of cases) {
      const harness = createAppApi(testCase.initialSession)
      testCase.configure?.(harness)
      const mounted = await mountApp(harness.api)

      expect(rootClassName(mounted), testCase.name).toBe(testCase.expectedClassName)
      expect(text(mounted), testCase.name).toContain(testCase.visibleText)
      expect(findButton(mounted, 'Retry') !== null, testCase.name).toBe(testCase.hasRetry)

      await mounted.unmount()
    }
  })

  it('restores the local session under React development Strict Mode effect replay', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api, { strictMode: true })

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).not.toContain('Checking local session.')
    expect(harness.api.auth.getSession).toHaveBeenCalled()

    await mounted.unmount()
  })

  it('moves from temporary-password login through required password change to ACTIVE', async () => {
    const harness = createAppApi(signedOutSession(1))
    harness.api.auth.login.mockResolvedValue(
      createIpcSuccess(passwordChangeSession(2)) as AuthLoginResult
    )
    harness.api.auth.changeRequiredPassword.mockResolvedValue(
      createIpcSuccess(activeSession(3)) as AuthChangeRequiredPasswordResult
    )
    const mounted = await mountApp(harness.api)

    await submitLogin(mounted, 'Admin.User', 'ValidPassword1!')

    expect(text(mounted)).toContain('Change required password.')

    const resetSpy = vi.spyOn(HTMLFormElement.prototype, 'reset')

    await submitPasswordChange(mounted, {
      currentPassword: 'ValidPassword1!',
      newPassword: 'ReplacementPassword1!',
      confirmNewPassword: 'ReplacementPassword1!'
    })

    expect(harness.api.auth.changeRequiredPassword).toHaveBeenCalledWith({
      currentPassword: 'ValidPassword1!',
      newPassword: 'ReplacementPassword1!',
      confirmNewPassword: 'ReplacementPassword1!'
    })
    expect(resetSpy).toHaveBeenCalled()
    expect(text(mounted)).toContain('Welcome, Admin User')

    await mounted.unmount()
  })

  it('moves from ACTIVE through manual lock, valid unlock, and back to ACTIVE', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.lock.mockResolvedValue(createIpcSuccess(lockedSession(2)) as AuthLockResult)
    harness.api.auth.unlock.mockResolvedValue(
      createIpcSuccess(activeSession(3)) as AuthUnlockResult
    )
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Welcome, Admin User')

    await clickButton(mounted, 'Lock')

    expect(text(mounted)).toContain('Session locked.')

    const resetSpy = vi.spyOn(HTMLFormElement.prototype, 'reset')

    await submitUnlock(mounted, 'ValidPassword1!')

    expect(harness.api.auth.unlock).toHaveBeenCalledWith({ password: 'ValidPassword1!' })
    expect(resetSpy).toHaveBeenCalled()
    expect(text(mounted)).toContain('Welcome, Admin User')

    await mounted.unmount()
  })

  it('retains LOCKED and clears the password field after a wrong unlock password', async () => {
    const harness = createAppApi(lockedSession(1))
    harness.api.auth.unlock.mockResolvedValue(
      createIpcSuccess({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      }) as AuthUnlockResult
    )
    const mounted = await mountApp(harness.api)

    await submitUnlock(mounted, 'WrongPassword1!')

    expect(text(mounted)).toContain('Session locked.')
    expect(text(mounted)).toContain('The username or password is incorrect.')
    expect(getInput(mounted, 'unlockPassword').value).toBe('')

    await mounted.unmount()
  })

  it('logs out from ACTIVE and LOCKED routes back to login', async () => {
    const activeHarness = createAppApi(activeSession(1))
    activeHarness.api.auth.logout.mockResolvedValue(
      createIpcSuccess(signedOutSession(2)) as AuthLogoutResult
    )
    const activeMounted = await mountApp(activeHarness.api)

    await clickButton(activeMounted, 'Sign out')

    expect(text(activeMounted)).toContain('Login')

    await activeMounted.unmount()

    const lockedHarness = createAppApi(lockedSession(3))
    lockedHarness.api.auth.logout.mockResolvedValue(
      createIpcSuccess(signedOutSession(4)) as AuthLogoutResult
    )
    const lockedMounted = await mountApp(lockedHarness.api)

    await clickButton(lockedMounted, 'Sign out')

    expect(text(lockedMounted)).toContain('Login')

    await lockedMounted.unmount()
  })

  it('lets a higher-revision event win during pending login and ignores stale completion', async () => {
    const harness = createAppApi(signedOutSession(1))
    const pendingLogin = deferred<AuthLoginResult>()
    harness.api.auth.login.mockReturnValue(pendingLogin.promise)
    const mounted = await mountApp(harness.api)

    await beginLogin(mounted, 'Admin.User', 'ValidPassword1!')
    await emitSession(harness, activeSession(5, userWithName('Event User')))

    expect(text(mounted)).toContain('Welcome, Event User')
    expect(text(mounted)).toContain('Event User')

    pendingLogin.resolve(
      createIpcSuccess(activeSession(3, userWithName('Stale User'))) as AuthLoginResult
    )
    await flushReact()

    expect(text(mounted)).toContain('Event User')
    expect(text(mounted)).not.toContain('Stale User')

    await mounted.unmount()
  })

  it('changes idle-expired UI only after getSession returns LOCKED', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-01T00:00:00.000Z') })

    const idleSession = activeSession(1, baseUser, {
      idleExpiresAt: '2026-08-01T00:00:01.000Z' as UtcTimestamp,
      absoluteExpiresAt: '2026-08-01T12:00:00.000Z' as UtcTimestamp
    })
    const pendingReconcile = deferred<AuthGetSessionResult>()
    let getSessionCount = 0
    const harness = createAppApi(idleSession)
    harness.setGetSession(() => {
      getSessionCount += 1
      return getSessionCount === 1
        ? Promise.resolve(createIpcSuccess(idleSession) as AuthGetSessionResult)
        : pendingReconcile.promise
    })
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Welcome, Admin User')

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await flushPromises()
    })

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Welcome, Admin User')

    pendingReconcile.resolve(createIpcSuccess(lockedSession(2)) as AuthGetSessionResult)
    await flushReact()

    expect(text(mounted)).toContain('Session locked.')

    await mounted.unmount()
  })

  it('changes absolute-expired UI only after getSession returns SIGNED_OUT', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-01T00:00:00.000Z') })

    const absoluteSession = activeSession(1, baseUser, {
      idleExpiresAt: '2026-08-01T01:00:00.000Z' as UtcTimestamp,
      absoluteExpiresAt: '2026-08-01T00:00:01.000Z' as UtcTimestamp
    })
    const pendingReconcile = deferred<AuthGetSessionResult>()
    let getSessionCount = 0
    const harness = createAppApi(absoluteSession)
    harness.setGetSession(() => {
      getSessionCount += 1
      return getSessionCount === 1
        ? Promise.resolve(createIpcSuccess(absoluteSession) as AuthGetSessionResult)
        : pendingReconcile.promise
    })
    const mounted = await mountApp(harness.api)

    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await flushPromises()
    })

    expect(text(mounted)).toContain('Welcome, Admin User')

    pendingReconcile.resolve(createIpcSuccess(signedOutSession(2)) as AuthGetSessionResult)
    await flushReact()

    expect(text(mounted)).toContain('Login')

    await mounted.unmount()
  })

  it('preserves the 60-second activity throttle across ACTIVE revisions', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-01T00:00:00.000Z') })

    const harness = createAppApi(activeSession(1))
    harness.api.auth.recordActivity
      .mockResolvedValueOnce(createIpcSuccess(activeSession(2, userWithName('Refreshed User'))))
      .mockResolvedValueOnce(createIpcSuccess(activeSession(3, userWithName('Trailing User'))))
    const mounted = await mountApp(harness.api)

    await dispatchWindowEvent('pointerdown')

    expect(harness.api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(text(mounted)).toContain('Refreshed User')

    await dispatchWindowEvent('keydown')

    expect(harness.api.auth.recordActivity).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(59_999)
      await flushPromises()
    })

    expect(harness.api.auth.recordActivity).toHaveBeenCalledOnce()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await flushPromises()
    })
    await flushReact()

    expect(harness.api.auth.recordActivity).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Trailing User')

    await emitSession(harness, lockedSession(4))
    await dispatchWindowEvent('wheel')

    expect(text(mounted)).toContain('Session locked.')
    expect(harness.api.auth.recordActivity).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })

  it('does not use browser storage or network APIs during authentication interaction', async () => {
    const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage
    const getItemSpy = vi.spyOn(storagePrototype, 'getItem')
    const setItemSpy = vi.spyOn(storagePrototype, 'setItem')
    const removeItemSpy = vi.spyOn(storagePrototype, 'removeItem')
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    const webSocketSpy = vi.fn()
    const indexedOpenSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)
    vi.stubGlobal('WebSocket', webSocketSpy)
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open: indexedOpenSpy }
    })

    const harness = createAppApi(signedOutSession(1))
    harness.api.auth.login.mockResolvedValue(createIpcSuccess(activeSession(2)) as AuthLoginResult)
    const mounted = await mountApp(harness.api)

    await submitLogin(mounted, 'Admin.User', 'ValidPassword1!')

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(webSocketSpy).not.toHaveBeenCalled()
    expect(indexedOpenSpy).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('keeps first-run setup screens ahead of authentication when setup is required', async () => {
    const harness = createAppApi(signedOutSession(1), {
      status: 'REQUIRED'
    })
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Set up this screening installation.')
    expect(text(mounted)).toContain('Administrator username required')
    expect(text(mounted)).not.toContain('Login')
    expect(harness.api.auth.getSession).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('fails closed when an ACTIVE event wins during pending initial load before IPC_FORBIDDEN', async () => {
    const pendingLoad = deferred<AuthGetSessionResult>()
    const harness = createAppApi(signedOutSession(0))
    harness.setGetSession(() => pendingLoad.promise)
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Checking local session.')

    await emitSession(harness, activeSession(5))

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain(baseUser.displayName)

    pendingLoad.resolve(createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult)
    await flushReact()

    expectForbiddenUnavailable(mounted)
    expect(text(mounted)).not.toContain('Welcome,')

    await emitSession(harness, activeSession(6, userWithName('Late Event User')))

    expectForbiddenUnavailable(mounted)
    expect(text(mounted)).not.toContain('Late Event User')

    await mounted.unmount()
  })

  it.each([
    {
      session: lockedSession(5),
      visibleText: 'Session locked.'
    },
    {
      session: passwordChangeSession(6),
      visibleText: 'Change required password.'
    }
  ])(
    'fails closed when a $session.status event wins during pending initial load before IPC_FORBIDDEN',
    async ({ session, visibleText }) => {
      const pendingLoad = deferred<AuthGetSessionResult>()
      const harness = createAppApi(signedOutSession(0))
      harness.setGetSession(() => pendingLoad.promise)
      const mounted = await mountApp(harness.api)

      await emitSession(harness, session)

      expect(text(mounted)).toContain(visibleText)
      expect(text(mounted)).toContain(baseUser.displayName)

      pendingLoad.resolve(createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult)
      await flushReact()

      expectForbiddenUnavailable(mounted)

      await mounted.unmount()
    }
  )

  it('preserves an ACTIVE initial-load event when getSession returns IPC_UNAVAILABLE', async () => {
    const pendingLoad = deferred<AuthGetSessionResult>()
    const harness = createAppApi(signedOutSession(0))
    harness.setGetSession(() => pendingLoad.promise)
    const mounted = await mountApp(harness.api)

    await emitSession(harness, activeSession(5))

    pendingLoad.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
    await flushReact()

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain(baseUser.displayName)
    expect(text(mounted)).not.toContain('Authentication is unavailable.')

    await mounted.unmount()
  })

  it('routes IPC_FORBIDDEN from every interactive screen to nonretryable unavailable', async () => {
    const cases: Array<{
      readonly initialSession: PublicAuthenticationSession
      configure(harness: AppApiHarness): void
      act(mounted: MountedApp): Promise<void>
    }> = [
      {
        initialSession: signedOutSession(1),
        configure(harness) {
          harness.api.auth.login.mockResolvedValue(
            createAuthenticationFailure('IPC_FORBIDDEN') as AuthLoginResult
          )
        },
        act: (mounted) => submitLogin(mounted, 'Admin.User', 'ValidPassword1!')
      },
      {
        initialSession: passwordChangeSession(2),
        configure(harness) {
          harness.api.auth.changeRequiredPassword.mockResolvedValue(
            createAuthenticationFailure('IPC_FORBIDDEN') as AuthChangeRequiredPasswordResult
          )
        },
        act: (mounted) =>
          submitPasswordChange(mounted, {
            currentPassword: 'ValidPassword1!',
            newPassword: 'ReplacementPassword1!',
            confirmNewPassword: 'ReplacementPassword1!'
          })
      },
      {
        initialSession: lockedSession(3),
        configure(harness) {
          harness.api.auth.unlock.mockResolvedValue(
            createAuthenticationFailure('IPC_FORBIDDEN') as AuthUnlockResult
          )
        },
        act: (mounted) => submitUnlock(mounted, 'ValidPassword1!')
      },
      {
        initialSession: activeSession(4),
        configure(harness) {
          harness.api.auth.lock.mockResolvedValue(
            createAuthenticationFailure('IPC_FORBIDDEN') as AuthLockResult
          )
        },
        act: (mounted) => clickButton(mounted, 'Lock')
      }
    ]

    for (const testCase of cases) {
      const harness = createAppApi(testCase.initialSession)
      testCase.configure(harness)
      const mounted = await mountApp(harness.api)

      await testCase.act(mounted)

      expect(text(mounted)).toContain('Authentication is unavailable.')
      expect(text(mounted)).toContain('Authentication is unavailable from the current window.')
      expect(findButton(mounted, 'Retry')).toBeNull()
      expect(text(mounted)).not.toContain(baseUser.displayName)

      await mounted.unmount()
    }
  })

  it('fails closed when deadline reconciliation returns IPC_FORBIDDEN', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-01T00:00:00.000Z') })

    const cases: Array<{
      readonly initialSession: PublicAuthenticationSession
      readonly visibleText: string
    }> = [
      {
        initialSession: activeSession(1, baseUser, {
          idleExpiresAt: '2026-08-01T00:00:01.000Z' as UtcTimestamp,
          absoluteExpiresAt: '2026-08-01T12:00:00.000Z' as UtcTimestamp
        }),
        visibleText: 'Welcome, Admin User'
      },
      {
        initialSession: lockedSession(2, baseUser, {
          absoluteExpiresAt: '2026-08-01T00:00:01.000Z' as UtcTimestamp
        }),
        visibleText: 'Session locked.'
      },
      {
        initialSession: passwordChangeSession(3, baseUser, {
          expiresAt: '2026-08-01T00:00:01.000Z' as UtcTimestamp
        }),
        visibleText: 'Change required password.'
      }
    ]

    for (const testCase of cases) {
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'))

      let getSessionCalls = 0
      const harness = createAppApi(testCase.initialSession)
      harness.setGetSession(() => {
        getSessionCalls += 1

        return Promise.resolve(
          getSessionCalls === 1
            ? (createIpcSuccess(testCase.initialSession) as AuthGetSessionResult)
            : (createAuthenticationFailure('IPC_FORBIDDEN') as AuthGetSessionResult)
        )
      })
      const mounted = await mountApp(harness.api)

      expect(text(mounted)).toContain(testCase.visibleText)

      await act(async () => {
        vi.advanceTimersByTime(1_000)
        await flushPromises()
      })
      await flushReact()

      expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
      expectForbiddenUnavailable(mounted)

      await mounted.unmount()
    }
  })

  it('fails closed when recordActivity returns IPC_FORBIDDEN', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.recordActivity.mockResolvedValue(
      createAuthenticationFailure('IPC_FORBIDDEN') as AuthRecordActivityResult
    )
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain(baseUser.displayName)

    await dispatchWindowEvent('pointerdown')

    expect(harness.api.auth.recordActivity).toHaveBeenCalledOnce()
    expectForbiddenUnavailable(mounted)
    expect(text(mounted)).not.toContain('Welcome,')

    await mounted.unmount()
  })

  it('does not let stale pending reconciliation or session events restore forbidden unavailable', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)
    const pendingReconcile = deferred<AuthGetSessionResult>()

    harness.setGetSession(() => pendingReconcile.promise)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await flushPromises()
    })

    harness.api.auth.recordActivity.mockResolvedValue(
      createAuthenticationFailure('IPC_FORBIDDEN') as AuthRecordActivityResult
    )

    await dispatchWindowEvent('pointerdown')

    expectForbiddenUnavailable(mounted)

    pendingReconcile.resolve(
      createIpcSuccess(activeSession(9, userWithName('Restored User'))) as AuthGetSessionResult
    )
    await flushReact()
    await emitSession(harness, activeSession(10, userWithName('Event User')))

    expectForbiddenUnavailable(mounted)
    expect(text(mounted)).not.toContain('Restored User')
    expect(text(mounted)).not.toContain('Event User')

    await mounted.unmount()
  })

  it('preserves the latest valid route when background reconciliation returns IPC_UNAVAILABLE', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    harness.setGetSession(() =>
      Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
    )

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await flushPromises()
    })
    await flushReact()

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain(baseUser.displayName)
    expect(text(mounted)).not.toContain('Authentication is unavailable.')

    await mounted.unmount()
  })

  it('reconciles once when lock succeeds in main but its response is unavailable', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.lock.mockImplementation(() => {
      harness.setSession(lockedSession(2))
      return Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLockResult)
    })
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Lock')

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Session locked.')

    await mounted.unmount()
  })

  it('reconciles once when logout succeeds in main but its response is unavailable', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.logout.mockImplementation(() => {
      harness.setSession(signedOutSession(2))
      return Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLogoutResult)
    })
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Sign out')

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Login')

    await mounted.unmount()
  })

  it('preserves the existing route when failure reconciliation also fails', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.lock.mockResolvedValue(
      createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLockResult
    )
    const mounted = await mountApp(harness.api)
    harness.setGetSession(() =>
      Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult)
    )

    await clickButton(mounted, 'Lock')

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain('The desktop authentication service is unavailable.')

    await mounted.unmount()
  })
})

type MockedAuthApi = HealthScreeningApi['auth'] & {
  getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
  login: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['login']>>
  changeRequiredPassword: ReturnType<
    typeof vi.fn<HealthScreeningApi['auth']['changeRequiredPassword']>
  >
  unlock: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['unlock']>>
  lock: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['lock']>>
  logout: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['logout']>>
  recordActivity: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['recordActivity']>>
  onSessionChanged: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['onSessionChanged']>>
}

type MockedHealthScreeningApi = HealthScreeningApi & {
  auth: MockedAuthApi
}

interface AppApiHarness {
  readonly api: MockedHealthScreeningApi
  setSession(session: PublicAuthenticationSession): void
  setGetSession(getSession: () => Promise<AuthGetSessionResult>): void
  emitSession(session: PublicAuthenticationSession): void
}

interface MountedApp {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

function createAppApi(
  initialSession: PublicAuthenticationSession,
  firstRunState: { readonly status: 'INITIALIZED' | 'REQUIRED' } = { status: 'INITIALIZED' }
): AppApiHarness {
  let currentSession = initialSession
  let getSession = (): Promise<AuthGetSessionResult> =>
    Promise.resolve(createIpcSuccess(currentSession) as AuthGetSessionResult)
  const listeners = new Set<AuthenticationSessionChangedListener>()

  const api = {
    app: {
      getInfo: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            applicationName: 'Health Screening Offline Desktop',
            applicationVersion: '1.0.0',
            platform: 'win32',
            architecture: 'x64',
            packaged: false
          })
        )
      ),
      getHealth: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'ready',
            ipc: 'available',
            database: 'ready',
            clinicalFeatures: 'not-implemented'
          })
        )
      )
    },
    firstRun: {
      getState: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess(
            firstRunState.status === 'INITIALIZED'
              ? {
                  status: 'INITIALIZED',
                  deploymentName: 'Local Deployment',
                  timeZone: 'Africa/Douala'
                }
              : { status: 'REQUIRED' }
          ) as FirstRunGetStateResult
        )
      ),
      initialize: vi.fn()
    },
    auth: {
      getSession: vi.fn(() => getSession()),
      login: vi.fn(() =>
        Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLoginResult)
      ),
      changeRequiredPassword: vi.fn(() =>
        Promise.resolve(
          createAuthenticationFailure('IPC_UNAVAILABLE') as AuthChangeRequiredPasswordResult
        )
      ),
      unlock: vi.fn(() =>
        Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthUnlockResult)
      ),
      lock: vi.fn(() =>
        Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLockResult)
      ),
      logout: vi.fn(() =>
        Promise.resolve(createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLogoutResult)
      ),
      recordActivity: vi.fn(() =>
        Promise.resolve(createIpcSuccess(activeSession(99)) as AuthRecordActivityResult)
      ),
      onSessionChanged: vi.fn((listener: AuthenticationSessionChangedListener) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      })
    }
  } as unknown as MockedHealthScreeningApi

  return {
    api,
    setSession(session: PublicAuthenticationSession): void {
      currentSession = session
    },
    setGetSession(nextGetSession: () => Promise<AuthGetSessionResult>): void {
      getSession = nextGetSession
    },
    emitSession(session: PublicAuthenticationSession): void {
      currentSession = session
      for (const listener of Array.from(listeners)) {
        listener(session)
      }
    }
  }
}

async function mountApp(
  api: HealthScreeningApi,
  options: { readonly strictMode?: boolean } = {}
): Promise<MountedApp> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const app = createElement(App, { api })

  await act(async () => {
    root.render(options.strictMode === true ? createElement(StrictMode, null, app) : app)
    await flushPromises()
  })
  await flushReact()

  return {
    container,
    async unmount(): Promise<void> {
      await unmountRoot(root)
      container.remove()
    }
  }
}

async function unmountRoot(root: Root): Promise<void> {
  await act(async () => {
    root.unmount()
    await flushPromises()
  })
}

async function beginLogin(mounted: MountedApp, username: string, password: string): Promise<void> {
  setInputValue(getInput(mounted, 'username'), username)
  setInputValue(getInput(mounted, 'password'), password)
  await submitFirstForm(mounted, false)
}

async function submitLogin(mounted: MountedApp, username: string, password: string): Promise<void> {
  await beginLogin(mounted, username, password)
  await flushReact()
}

async function submitPasswordChange(
  mounted: MountedApp,
  values: {
    readonly currentPassword: string
    readonly newPassword: string
    readonly confirmNewPassword: string
  }
): Promise<void> {
  setInputValue(getInput(mounted, 'currentPassword'), values.currentPassword)
  setInputValue(getInput(mounted, 'newPassword'), values.newPassword)
  setInputValue(getInput(mounted, 'confirmNewPassword'), values.confirmNewPassword)
  await submitFirstForm(mounted)
}

async function submitUnlock(mounted: MountedApp, password: string): Promise<void> {
  setInputValue(getInput(mounted, 'unlockPassword'), password)
  await submitFirstForm(mounted)
}

async function submitFirstForm(mounted: MountedApp, waitForCompletion = true): Promise<void> {
  const form = mounted.container.querySelector('form')

  if (form === null) {
    throw new Error('Expected a form to be rendered.')
  }

  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
  })

  if (waitForCompletion) {
    await flushReact()
  }
}

async function clickButton(mounted: MountedApp, label: string): Promise<void> {
  const button = findButton(mounted, label)

  if (button === null) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function emitSession(
  harness: AppApiHarness,
  session: PublicAuthenticationSession
): Promise<void> {
  await act(async () => {
    harness.emitSession(session)
    await flushPromises()
  })
  await flushReact()
}

async function dispatchWindowEvent(type: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event(type, { bubbles: true }))
    await flushPromises()
  })
  await flushReact()
}

function getInput(mounted: MountedApp, id: string): HTMLInputElement {
  const input = mounted.container.querySelector<HTMLInputElement>(`#${id}`)

  if (input === null) {
    throw new Error(`Expected input ${id} to be rendered.`)
  }

  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function findButton(mounted: MountedApp, label: string): HTMLButtonElement | null {
  return (
    Array.from(mounted.container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === label
    ) ?? null
  )
}

function text(mounted: MountedApp): string {
  return mounted.container.textContent ?? ''
}

function rootClassName(mounted: MountedApp): string {
  const root = mounted.container.firstElementChild

  if (!(root instanceof HTMLElement)) {
    throw new Error('Expected mounted app root element to be rendered.')
  }

  return root.className
}

function expectForbiddenUnavailable(mounted: MountedApp): void {
  expect(text(mounted)).toContain('Authentication is unavailable.')
  expect(text(mounted)).toContain('Authentication is unavailable from the current window.')
  expect(findButton(mounted, 'Retry')).toBeNull()
  expect(text(mounted)).not.toContain(baseUser.displayName)
}

async function flushReact(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await flushPromises()
    })
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function deferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return {
    promise,
    resolve(value: T): void {
      if (resolveValue === undefined) {
        throw new Error('Deferred promise resolver is unavailable.')
      }

      resolveValue(value)
    }
  }
}

function userWithName(displayName: string): PublicAuthenticatedUser {
  return {
    ...baseUser,
    displayName
  }
}

function signedOutSession(revision: number): PublicSignedOutAuthenticationSession {
  return {
    status: 'SIGNED_OUT',
    revision
  }
}

function passwordChangeSession(
  revision: number,
  user: PublicAuthenticatedUser = baseUser,
  overrides: Partial<PublicPasswordChangeRequiredAuthenticationSession> = {}
): PublicPasswordChangeRequiredAuthenticationSession {
  return {
    status: 'PASSWORD_CHANGE_REQUIRED',
    user,
    expiresAt: futureTimestamp(15 * 60_000),
    revision,
    ...overrides
  }
}

function activeSession(
  revision: number,
  user: PublicAuthenticatedUser = baseUser,
  overrides: Partial<PublicActiveAuthenticationSession> = {}
): PublicActiveAuthenticationSession {
  return {
    status: 'ACTIVE',
    user,
    idleExpiresAt: futureTimestamp(15 * 60_000),
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision,
    ...overrides
  }
}

function lockedSession(
  revision: number,
  user: PublicAuthenticatedUser = baseUser,
  overrides: Partial<PublicLockedAuthenticationSession> = {}
): PublicLockedAuthenticationSession {
  return {
    status: 'LOCKED',
    user,
    reason: 'MANUAL',
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision,
    ...overrides
  }
}

function futureTimestamp(offsetMs: number): UtcTimestamp {
  return new Date(Date.now() + offsetMs).toISOString() as UtcTimestamp
}
