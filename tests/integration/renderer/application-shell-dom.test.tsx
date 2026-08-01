// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type AuthGetSessionResult,
  type AuthLockResult,
  type AuthLogoutResult,
  type AuthRecordActivityResult,
  type AuthenticationSessionChangedListener,
  type FirstRunGetStateResult,
  type HealthScreeningApi,
  type LocalUserRole,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession,
  type PublicAuthenticatedUser,
  type PublicLockedAuthenticationSession,
  type PublicSignedOutAuthenticationSession,
  type UtcTimestamp
} from '@shared/ipc'
import App from '../../../src/renderer/src/app/App'

const baseUser: PublicAuthenticatedUser = {
  username: 'Admin.User',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN'
}

describe('application shell DOM integration', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the full dashboard shell after setup complete and active session', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain('Local Deployment')
    expect(text(mounted)).toContain('Africa/Douala')
    expect(text(mounted)).toContain('No active location selected')
    expect(text(mounted)).toContain('No screening session open')
    expect(primaryMenuLabels(mounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals',
      'Reports',
      'Administration'
    ])
    expect(text(mounted)).toContain('Screened today')
    expect(text(mounted)).toContain('Patient code')
    expect(text(mounted)).toContain('Patient worklist data is not available in HSD-024.')
    expect(text(mounted)).not.toContain('Admin.User')

    await mounted.unmount()
  })

  it('filters primary menus by active role', async () => {
    const nurseMounted = await mountApp(createAppApi(activeSession(1, userWithRole('NURSE'))).api)
    expect(primaryMenuLabels(nurseMounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals',
      'Reports'
    ])
    expect(text(nurseMounted)).not.toContain('Administration')
    await nurseMounted.unmount()

    const screenerMounted = await mountApp(
      createAppApi(activeSession(2, userWithRole('TRAINED_SCREENER'))).api
    )
    expect(primaryMenuLabels(screenerMounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals'
    ])
    expect(text(screenerMounted)).not.toContain('Reports')
    expect(text(screenerMounted)).not.toContain('Administration')
    await screenerMounted.unmount()
  })

  it('opens one contextual command panel at a time and restores focus on Escape', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')

    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')
    expect(menuButton(mounted, 'Patients').getAttribute('aria-expanded')).toBe('true')

    await clickButton(mounted, 'Screening')

    expect(commandPanel(mounted)?.textContent).toContain('New Screening')
    expect(commandPanel(mounted)?.textContent).not.toContain('Patient Search')
    expect(menuButton(mounted, 'Patients').getAttribute('aria-expanded')).toBe('false')

    await dispatchKeyboard(commandPanel(mounted)!, 'Escape')

    expect(commandPanel(mounted)).toBeNull()
    expect(document.activeElement).toBe(menuButton(mounted, 'Screening'))

    await mounted.unmount()
  })

  it('supports roving primary menu keys and F6 focus-zone cycling', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)
    const home = menuButton(mounted, 'Home')

    home.focus()
    await dispatchKeyboard(home, 'ArrowRight')
    expect(document.activeElement).toBe(menuButton(mounted, 'Patients'))

    await dispatchKeyboard(menuButton(mounted, 'Patients'), 'End')
    expect(document.activeElement).toBe(menuButton(mounted, 'Administration'))

    await dispatchKeyboard(menuButton(mounted, 'Administration'), 'Home')
    expect(document.activeElement).toBe(home)

    await dispatchKeyboard(home, 'Enter')
    expect(commandPanel(mounted)?.textContent).toContain('Dashboard')

    await dispatchWindowKeyboard('F6')
    expect(document.activeElement?.textContent).toContain('Dashboard')

    await dispatchWindowKeyboard('F6')
    expect(document.activeElement?.textContent).toContain('Welcome, Admin User')

    await dispatchWindowKeyboard('F6', true)
    expect(document.activeElement?.textContent).toContain('Dashboard')

    await mounted.unmount()
  })

  it('routes planned commands and quick actions to transparent planned workspaces', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Patient Search')

    expect(text(mounted)).toContain('Patient Search')
    expect(text(mounted)).toContain('Not available in this build.')
    expect(text(mounted)).toContain('HSD-025 patient search and tabs')
    expect(mounted.container.querySelector('form')).toBeNull()
    expect(text(mounted)).not.toContain('Create patient and open tab')

    await clickButton(mounted, 'Back to dashboard')

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(menuButton(mounted, 'Home').getAttribute('aria-current')).toBe('page')

    await clickButton(mounted, 'Find or open patient')

    expect(text(mounted)).toContain('Patient Search')
    expect(text(mounted)).toContain('Not available in this build.')

    await mounted.unmount()
  })

  it('keeps shell route state across active revisions and resets after leaving active', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')

    await emitSession(harness, activeSession(2, { ...baseUser, displayName: 'Updated User' }))

    expect(text(mounted)).toContain('Welcome, Updated User')
    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')

    await emitSession(harness, lockedSession(3))
    expect(text(mounted)).toContain('Session locked.')

    await emitSession(harness, activeSession(4))

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(commandPanel(mounted)).toBeNull()
    expect(menuButton(mounted, 'Home').getAttribute('aria-current')).toBe('page')

    await mounted.unmount()
  })

  it('does not use browser persistence, URL routing, network APIs, or extra preload calls during shell navigation', async () => {
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

    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Patient Search')
    await clickButton(mounted, 'Back to dashboard')

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(webSocketSpy).not.toHaveBeenCalled()
    expect(indexedOpenSpy).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(harness.api.app.getInfo).toHaveBeenCalledOnce()
    expect(harness.api.app.getHealth).toHaveBeenCalledOnce()
    expect(harness.api.firstRun.getState).toHaveBeenCalledOnce()

    await mounted.unmount()
  })
})

type MockedHealthScreeningApi = HealthScreeningApi & {
  app: {
    getInfo: ReturnType<typeof vi.fn<HealthScreeningApi['app']['getInfo']>>
    getHealth: ReturnType<typeof vi.fn<HealthScreeningApi['app']['getHealth']>>
  }
  firstRun: {
    getState: ReturnType<typeof vi.fn<HealthScreeningApi['firstRun']['getState']>>
    initialize: ReturnType<typeof vi.fn<HealthScreeningApi['firstRun']['initialize']>>
  }
}

interface AppApiHarness {
  readonly api: MockedHealthScreeningApi
  emitSession(session: PublicAuthenticationSession): void
}

interface MountedApp {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

function createAppApi(initialSession: PublicAuthenticationSession): AppApiHarness {
  let currentSession = initialSession
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
          createIpcSuccess({
            status: 'INITIALIZED',
            deploymentName: 'Local Deployment',
            timeZone: 'Africa/Douala'
          }) as FirstRunGetStateResult
        )
      ),
      initialize: vi.fn()
    },
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve(createIpcSuccess(currentSession) as AuthGetSessionResult)
      ),
      login: vi.fn(),
      changeRequiredPassword: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(() => Promise.resolve(createIpcSuccess(lockedSession(99)) as AuthLockResult)),
      logout: vi.fn(() =>
        Promise.resolve(createIpcSuccess(signedOutSession(99)) as AuthLogoutResult)
      ),
      recordActivity: vi.fn(() =>
        Promise.resolve(createIpcSuccess(activeSession(100)) as AuthRecordActivityResult)
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
    emitSession(session: PublicAuthenticationSession): void {
      currentSession = session

      for (const listener of Array.from(listeners)) {
        listener(session)
      }
    }
  }
}

async function mountApp(api: HealthScreeningApi): Promise<MountedApp> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(App, { api }))
    await flushPromises()
  })
  await flushReact()

  return {
    container,
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

async function clickButton(mounted: MountedApp, label: string): Promise<void> {
  const button = Array.from(mounted.container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label)
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function dispatchKeyboard(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function dispatchWindowKeyboard(key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
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

function primaryMenuLabels(mounted: MountedApp): string[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Primary application navigation"] button'
    )
  ).map((button) => button.textContent?.trim() ?? '')
}

function menuButton(mounted: MountedApp, label: string): HTMLButtonElement {
  const button = Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Primary application navigation"] button'
    )
  ).find((candidate) => candidate.textContent?.trim() === label)

  if (button === undefined) {
    throw new Error(`Expected primary menu ${label} to be rendered.`)
  }

  return button
}

function commandPanel(mounted: MountedApp): HTMLElement | null {
  return mounted.container.querySelector('#application-command-panel')
}

function text(mounted: MountedApp): string {
  return mounted.container.textContent ?? ''
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

function userWithRole(role: LocalUserRole): PublicAuthenticatedUser {
  return {
    ...baseUser,
    role
  }
}

function activeSession(
  revision: number,
  user: PublicAuthenticatedUser = baseUser
): PublicActiveAuthenticationSession {
  return {
    status: 'ACTIVE',
    user,
    idleExpiresAt: futureTimestamp(15 * 60_000),
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision
  }
}

function lockedSession(revision: number): PublicLockedAuthenticationSession {
  return {
    status: 'LOCKED',
    user: baseUser,
    reason: 'MANUAL',
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision
  }
}

function signedOutSession(revision: number): PublicSignedOutAuthenticationSession {
  return {
    status: 'SIGNED_OUT',
    revision
  }
}

function futureTimestamp(offsetMs: number): UtcTimestamp {
  return new Date(Date.now() + offsetMs).toISOString() as UtcTimestamp
}
