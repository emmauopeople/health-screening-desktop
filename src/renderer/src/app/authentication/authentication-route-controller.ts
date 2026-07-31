import type {
  AuthGetSessionResult,
  HealthScreeningApi,
  PublicAuthenticationSession
} from '@shared/ipc'

import type { RendererAuthenticationRoute } from './authentication-route-types'

export const authenticationRouteCopy = {
  loading: 'Loading local session.',
  loginRequiredHeading: 'Sign in required.',
  loginRequiredStatement: 'The complete sign-in experience will be available in the next task.',
  passwordChangeHeading: 'Password change required.',
  passwordChangeStatement:
    'This account must change its temporary password before clinical workflows open.',
  lockedHeading: 'Session locked.',
  lockedStatement: 'The complete unlock experience will be available in the next task.',
  activeHeading: 'Session active.',
  activeStatement: 'Clinical workflows are not implemented in this task.',
  unavailableHeading: 'Authentication is unavailable.',
  unavailableStatement: 'The desktop service could not provide local session status.',
  forbiddenStatement: 'Authentication is unavailable from the current window.'
} as const

export interface RendererAuthenticationRouteController {
  load(): Promise<void>
  dispose(): void
}

export interface RendererAuthenticationRouteControllerOptions {
  readonly api: HealthScreeningApi
  readonly onRoute: (route: RendererAuthenticationRoute) => void
  readonly loadSession?: (api: HealthScreeningApi) => Promise<AuthGetSessionResult>
  readonly subscribe?: (
    api: HealthScreeningApi,
    listener: (session: PublicAuthenticationSession) => void
  ) => () => void
}

export function createRendererAuthenticationRouteController({
  api,
  onRoute,
  loadSession = (healthScreeningApi) => healthScreeningApi.auth.getSession(),
  subscribe = (healthScreeningApi, listener) => healthScreeningApi.auth.onSessionChanged(listener)
}: RendererAuthenticationRouteControllerOptions): RendererAuthenticationRouteController {
  let generation = 0
  let disposed = false
  let unsubscribe = noop
  let latestRevision = -1

  async function load(): Promise<void> {
    const activeGeneration = generation + 1
    generation = activeGeneration
    latestRevision = -1
    unsubscribe()
    unsubscribe = noop
    onRoute({ status: 'AUTH_LOADING' })

    try {
      unsubscribe = subscribe(api, (session) => {
        if (disposed || activeGeneration !== generation) {
          return
        }

        applySessionRoute(session)
      })
    } catch {
      if (!disposed && activeGeneration === generation) {
        onRoute(createUnavailableRoute())
      }

      return
    }

    try {
      const result = await loadSession(api)

      if (disposed || activeGeneration !== generation) {
        return
      }

      if (!result.ok) {
        onRoute(createUnavailableRoute(result.error.code === 'IPC_FORBIDDEN'))
        return
      }

      applySessionRoute(result.data)
    } catch {
      if (!disposed && activeGeneration === generation) {
        onRoute(createUnavailableRoute())
      }
    }
  }

  function applySessionRoute(session: PublicAuthenticationSession): void {
    if (session.revision < latestRevision) {
      return
    }

    latestRevision = session.revision
    onRoute(mapPublicAuthenticationSessionToRoute(session))
  }

  return {
    load,
    dispose() {
      disposed = true
      generation += 1
      unsubscribe()
      unsubscribe = noop
    }
  }
}

export function mapPublicAuthenticationSessionToRoute(
  session: PublicAuthenticationSession
): RendererAuthenticationRoute {
  switch (session.status) {
    case 'SIGNED_OUT':
      return {
        status: 'LOGIN_REQUIRED',
        revision: session.revision
      }
    case 'PASSWORD_CHANGE_REQUIRED':
      return {
        status: 'PASSWORD_CHANGE_REQUIRED',
        user: session.user,
        expiresAt: session.expiresAt,
        revision: session.revision
      }
    case 'ACTIVE':
      return {
        status: 'SESSION_ACTIVE',
        user: session.user,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        revision: session.revision
      }
    case 'LOCKED':
      return {
        status: 'SESSION_LOCKED',
        user: session.user,
        reason: session.reason,
        absoluteExpiresAt: session.absoluteExpiresAt,
        revision: session.revision
      }
  }
}

function createUnavailableRoute(forbidden = false): RendererAuthenticationRoute {
  return {
    status: 'AUTH_UNAVAILABLE',
    message: forbidden
      ? authenticationRouteCopy.forbiddenStatement
      : authenticationRouteCopy.unavailableStatement,
    retryable: !forbidden
  }
}

function noop(): void {
  return undefined
}
