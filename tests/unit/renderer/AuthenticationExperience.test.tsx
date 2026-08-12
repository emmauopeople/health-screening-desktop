import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  AuthenticatedShell,
  AuthenticationExperience,
  LockedSessionScreen,
  LoginScreen,
  RequiredPasswordChangeScreen
} from '../../../src/renderer/src/app/authentication'
import type { RendererAuthenticationRouteController } from '../../../src/renderer/src/app/authentication/authentication-route-controller'
import type { RendererAuthenticationRoute } from '../../../src/renderer/src/app/authentication/authentication-route-types'
import type { ApplicationShellContext } from '../../../src/renderer/src/app/shell'
import type { HealthScreeningApi, PublicAuthenticatedUser, UtcTimestamp } from '@shared/ipc'

const user: PublicAuthenticatedUser = {
  username: 'Admin.User',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN'
}

const provisionalRoute: Extract<
  RendererAuthenticationRoute,
  { status: 'PASSWORD_CHANGE_REQUIRED' }
> = {
  status: 'PASSWORD_CHANGE_REQUIRED',
  user,
  expiresAt: '2026-07-31T12:15:00.000Z' as UtcTimestamp,
  revision: 7
}
const lockedRoute: Extract<RendererAuthenticationRoute, { status: 'SESSION_LOCKED' }> = {
  status: 'SESSION_LOCKED',
  user,
  reason: 'IDLE_TIMEOUT',
  absoluteExpiresAt: '2026-07-31T18:00:00.000Z' as UtcTimestamp,
  revision: 8
}
const activeRoute: Extract<RendererAuthenticationRoute, { status: 'SESSION_ACTIVE' }> = {
  status: 'SESSION_ACTIVE',
  user,
  idleExpiresAt: '2026-07-31T12:15:00.000Z' as UtcTimestamp,
  absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as UtcTimestamp,
  revision: 9
}
const shellContext: ApplicationShellContext = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  deploymentName: 'Local Deployment',
  timeZone: 'Africa/Douala'
}

describe('authentication renderer experience', () => {
  it('renders the signed-out login form with uncontrolled credential fields', () => {
    const markup = renderToStaticMarkup(
      createElement(LoginScreen, {
        api: createApi(),
        controller: createController(),
        onExit: vi.fn()
      })
    )

    expect(markup).toContain('Welcome to Community Health Screening')
    expect(markup).toContain('The One Place to Track Your Health')
    expect(markup).toContain('<h1 id="auth-login-heading" tabindex="-1">Login</h1>')
    expect(markup).toContain('for="username"')
    expect(markup).toContain('for="password"')
    expect(markup).toContain('class="auth-required-indicator"')
    expect(markup).toContain('required=""')
    expect(markup).toContain('name="username"')
    expect(markup).toContain('name="password"')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('minLength="12"')
    expect(markup).toContain('maxLength="128"')
    expect(markup).toContain('Forgot username or password?')
    expect(markup).toContain('Sign In')
    expect(markup).toContain('Exit Application')
    expect(markup).not.toContain('Local authentication')
    expect(markup).not.toContain('Local account')
    expect(markup).not.toContain('Fields marked required')
    expect(markup).not.toContain('Use the local password')
    expect(markup).not.toContain('value=')
    assertNoInternalAuthenticationFragments(markup)
  })

  it('renders the required password-change form with safe public identity only', () => {
    const markup = renderToStaticMarkup(
      createElement(RequiredPasswordChangeScreen, {
        api: createApi(),
        controller: createController(),
        route: provisionalRoute
      })
    )

    expect(markup).toContain('Change required password.')
    expect(markup).toContain('Admin User')
    expect(markup).toContain('Admin.User')
    expect(markup).toContain('Local administrator')
    expect(markup).toContain('name="currentPassword"')
    expect(markup).toContain('name="newPassword"')
    expect(markup).toContain('name="confirmNewPassword"')
    expect(markup).toContain('12-128 characters')
    expect(markup).toContain('avoid control characters')
    expect(markup).toContain('choose a password different from the current password')
    expect(markup).toContain('Change password')
    expect(markup).toContain('Sign out')
    assertNoInternalAuthenticationFragments(markup)
  })

  it('renders the locked-session form with the Login visual content only', () => {
    const markup = renderToStaticMarkup(
      createElement(LockedSessionScreen, {
        api: createApi(),
        controller: createController(),
        route: lockedRoute
      })
    )

    expect(markup).toContain('class="auth-login-page"')
    expect(markup).toContain('auth-login-card')
    expect(markup).toContain('<h1 id="auth-locked-heading" tabindex="-1">Session Locked</h1>')
    expect(markup).toContain('By Admin.User')
    expect(markup).toContain('<legend>Unlock session</legend>')
    expect(markup).toContain('for="unlockPassword"')
    expect(markup).toContain('Password ')
    expect(markup).toContain('class="auth-required-indicator"')
    expect(markup).toContain('name="password"')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('required=""')
    expect(markup).toContain('Unlock')
    expect(markup).toContain('Sign out')
    expect(markup).not.toContain('Admin User')
    expect(markup).not.toContain('Local administrator')
    expect(markup).not.toContain('This session locked')
    expect(markup).not.toContain('session expires')
    expect(markup).not.toContain('Enter the local account password')
    expect(markup).not.toContain('12-128 characters')
    assertNoInternalAuthenticationFragments(markup)
  })

  it('renders the authenticated application shell with safe public context', () => {
    const markup = renderToStaticMarkup(
      createElement(AuthenticatedShell, {
        api: createApi(),
        controller: createController(),
        route: activeRoute,
        shellContext
      })
    )

    expect(markup).toContain('Welcome, Admin User')
    expect(markup).toContain('Health Screening Offline Desktop')
    expect(markup).toContain('Local data ready')
    expect(markup).toContain('Local Deployment')
    expect(markup).toContain('Home')
    expect(markup).toContain('Patients')
    expect(markup).toContain('Administration')
    expect(markup).toContain('Screened today')
    expect(markup).toContain('Patient worklist data is not available in HSD-024.')
    expect(markup).toContain('Lock')
    expect(markup).toContain('Sign out')
    expect(markup).not.toContain('Admin.User')
    expect(markup).not.toContain('session revision')
    assertNoInternalAuthenticationFragments(markup)
  })

  it('selects the concrete screen for every authentication route', () => {
    const routes: RendererAuthenticationRoute[] = [
      { status: 'AUTH_LOADING' },
      { status: 'AUTH_UNAVAILABLE', message: 'Unavailable', retryable: true },
      { status: 'LOGIN_REQUIRED', revision: 1 },
      {
        status: 'PASSWORD_CHANGE_REQUIRED',
        user,
        expiresAt: '2026-07-31T12:15:00.000Z' as UtcTimestamp,
        revision: 2
      },
      {
        status: 'SESSION_LOCKED',
        user,
        reason: 'MANUAL',
        absoluteExpiresAt: '2026-07-31T18:00:00.000Z' as UtcTimestamp,
        revision: 3
      },
      {
        status: 'SESSION_ACTIVE',
        user,
        idleExpiresAt: '2026-07-31T12:15:00.000Z' as UtcTimestamp,
        absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as UtcTimestamp,
        revision: 4
      }
    ]

    const markup = routes.map((route) =>
      renderToStaticMarkup(
        createElement(AuthenticationExperience, {
          api: createApi(),
          controller: createController(),
          route,
          shellContext,
          onExit: vi.fn()
        })
      )
    )

    expect(markup[0]).toContain('Checking local session.')
    expect(markup[1]).toContain('Authentication is unavailable.')
    expect(markup[1]).toContain('Retry')
    expect(markup[2]).toContain('Login')
    expect(markup[3]).toContain('Change required password.')
    expect(markup[4]).toContain('Session Locked')
    expect(markup[5]).toContain('Welcome, Admin User')
  })

  it('keeps authentication renderer code inside the preload and persistence boundary', () => {
    const authenticationFiles = [
      'src/renderer/src/app/authentication/AuthenticatedShell.tsx',
      'src/renderer/src/app/authentication/AuthenticationExperience.tsx',
      'src/renderer/src/app/authentication/AuthenticationLayout.tsx',
      'src/renderer/src/app/authentication/AuthenticationLoadingScreen.tsx',
      'src/renderer/src/app/authentication/AuthenticationUnavailableScreen.tsx',
      'src/renderer/src/app/authentication/LockedSessionScreen.tsx',
      'src/renderer/src/app/authentication/LoginScreen.tsx',
      'src/renderer/src/app/authentication/RequiredFieldIndicator.tsx',
      'src/renderer/src/app/authentication/RequiredPasswordChangeScreen.tsx',
      'src/renderer/src/app/authentication/authentication-failure-actions.ts',
      'src/renderer/src/app/authentication/authentication-form-controller.ts',
      'src/renderer/src/app/authentication/authentication-message-mapping.ts',
      'src/renderer/src/app/authentication/authentication-role-labels.ts',
      'src/renderer/src/app/authentication/authentication-route-controller.ts',
      'src/renderer/src/app/authentication/authentication-route-types.ts',
      'src/renderer/src/app/authentication/authentication-session-runtime.ts',
      'src/renderer/src/app/shell/ApplicationShell.tsx',
      'src/renderer/src/app/shell/ApplicationTopBar.tsx',
      'src/renderer/src/app/shell/ApplicationWorkspace.tsx',
      'src/renderer/src/app/shell/ContextCommandPanel.tsx',
      'src/renderer/src/app/shell/DashboardWorkspace.tsx',
      'src/renderer/src/app/shell/PlannedModuleWorkspace.tsx',
      'src/renderer/src/app/shell/application-navigation-catalog.ts',
      'src/renderer/src/app/shell/application-shell-controller.ts',
      'src/renderer/src/app/shell/application-shell-focus.ts',
      'src/renderer/src/app/shell/application-shell-types.ts'
    ]
    const bannedFragments = [
      '@main',
      '@preload',
      'electron',
      'better-sqlite3',
      'node:',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'XMLHttpRequest',
      'WebSocket',
      'console.log',
      'console.warn',
      'console.error'
    ]
    const bannedTokenPatterns = [/\bprocess\b/, /\bBuffer\b/, /\brequire\s*\(/, /\bfetch\s*\(/]

    for (const relativePath of authenticationFiles) {
      const source = readFileSync(join(__dirname, '../../../', relativePath), 'utf8')

      for (const fragment of bannedFragments) {
        expect(source, `${relativePath} contains ${fragment}`).not.toContain(fragment)
      }

      for (const pattern of bannedTokenPatterns) {
        expect(source, `${relativePath} matches ${pattern.toString()}`).not.toMatch(pattern)
      }
    }
  })

  it('keeps authentication controls responsive for narrow renderer viewports', () => {
    const css = readFileSync(join(__dirname, '../../../src/renderer/src/styles/main.css'), 'utf8')

    expect(css).toContain('min-width: 320px;')
    expect(css).toContain('min-height: 44px;')
    expect(css).toContain('width: min(560px, 100%);')
    expect(css).toContain('.auth-grid')
    expect(css).toContain('.application-top-bar')
    expect(css).toContain('.application-command-panel')
    expect(css).toContain('grid-template-columns: 1fr;')
    expect(css).toContain('width: 100%;')
    expect(css).toContain('.auth-login-root')
    expect(css).toContain('.auth-login-page')
    expect(css).toContain('background-color: #0b4960;')
    expect(css).toContain("url('../../../../assests/images/background-image.png')")
    expect(css).toContain('background-position: center;')
    expect(css).toContain('background-repeat: no-repeat;')
    expect(css).toContain('background-size: cover;')
    expect(css).toContain('place-items: center;')
    expect(css).toContain('.auth-login-card')
    expect(css).toContain('border-radius: 16px;')
    expect(css).toContain('.auth-required-indicator')
    expect(css).toContain('color: #c53030;')
    expect(css).not.toMatch(/url\(['"]?(?:https?:|data:)/i)
  })
})

function createApi(): HealthScreeningApi {
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
      recordActivity: vi.fn(),
      onSessionChanged: vi.fn()
    }
  } as unknown as HealthScreeningApi
}

function createController(): RendererAuthenticationRouteController {
  return {
    load: vi.fn(),
    reconcile: vi.fn(),
    acceptSession: vi.fn(),
    showUnavailable: vi.fn(),
    dispose: vi.fn()
  }
}

function assertNoInternalAuthenticationFragments(markup: string): void {
  for (const fragment of ['userId', 'credential', 'hash', 'salt', 'failed_login']) {
    expect(markup).not.toContain(fragment)
  }
}
