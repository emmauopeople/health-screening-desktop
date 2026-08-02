import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type AuthGetSessionResult,
  type HealthScreeningApi,
  type PublicAuthenticationSession
} from '@shared/ipc'
import {
  AuthenticationExperience,
  createRendererAuthenticationRouteController,
  type RendererAuthenticationRoute
} from '../../../src/renderer/src/app/authentication'
import type { ApplicationShellContext } from '../../../src/renderer/src/app/shell'

const user = {
  username: 'Admin.User',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN'
} as const
const shellContext: ApplicationShellContext = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  deploymentName: 'Local Deployment',
  timeZone: 'Africa/Douala'
}

describe('renderer authentication experience integration', () => {
  it('renders the current controller route after loading and accepting session observations', async () => {
    let route: RendererAuthenticationRoute = { status: 'AUTH_LOADING' }
    let session: PublicAuthenticationSession = { status: 'SIGNED_OUT', revision: 1 }
    const api = createApi(() => Promise.resolve(createIpcSuccess(session) as AuthGetSessionResult))
    const controller = createRendererAuthenticationRouteController({
      api,
      onRoute: (nextRoute) => {
        route = nextRoute
      }
    })

    await controller.load()

    expect(render(route, api, controller)).toContain('Sign in to Health Screening.')

    controller.acceptSession({
      status: 'PASSWORD_CHANGE_REQUIRED',
      user,
      expiresAt: '2026-07-31T12:15:00.000Z' as never,
      revision: 2
    })
    expect(render(route, api, controller)).toContain('Change required password.')

    controller.acceptSession({
      status: 'ACTIVE',
      user,
      idleExpiresAt: '2026-07-31T12:15:00.000Z' as never,
      absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
      revision: 3
    })
    expect(render(route, api, controller)).toContain('Welcome, Admin User')

    session = {
      status: 'LOCKED',
      user,
      reason: 'MANUAL',
      absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
      revision: 4
    }
    await controller.reconcile()

    expect(render(route, api, controller)).toContain('Session locked.')
  })
})

function render(
  route: RendererAuthenticationRoute,
  api: HealthScreeningApi,
  controller: ReturnType<typeof createRendererAuthenticationRouteController>
): string {
  return renderToStaticMarkup(
    createElement(AuthenticationExperience, {
      api,
      controller,
      route,
      shellContext,
      onExit: vi.fn()
    })
  )
}

function createApi(getSession: () => Promise<AuthGetSessionResult>): HealthScreeningApi & {
  auth: HealthScreeningApi['auth'] & {
    getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
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
      getSession: vi.fn(getSession),
      login: vi.fn(),
      changeRequiredPassword: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(),
      logout: vi.fn(),
      recordActivity: vi.fn(),
      onSessionChanged: vi.fn(() => () => undefined)
    }
  } as unknown as HealthScreeningApi & {
    auth: HealthScreeningApi['auth'] & {
      getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
    }
  }
}
