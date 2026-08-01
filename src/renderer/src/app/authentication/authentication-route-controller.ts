import type {
  AuthGetSessionResult,
  HealthScreeningApi,
  PublicAuthenticationSession
} from '@shared/ipc'

import type { RendererAuthenticationRoute } from './authentication-route-types'

export const authenticationRouteCopy = {
  loadingHeading: 'Checking local session.',
  loading: 'Loading local session.',
  loginRequiredHeading: 'Sign in required.',
  loginRequiredStatement: 'Use a local account for this screening installation.',
  passwordChangeHeading: 'Password change required.',
  passwordChangeStatement:
    'This account must change its temporary password before work can continue.',
  lockedHeading: 'Session locked.',
  lockedStatement: 'Unlock this local session to continue.',
  activeHeading: 'Session active.',
  activeStatement: 'The local account is active on this computer.',
  unavailableHeading: 'Authentication is unavailable.',
  unavailableStatement: 'The desktop service could not provide local session status.',
  forbiddenStatement: 'Authentication is unavailable from the current window.',
  retryLabel: 'Retry'
} as const

export interface RendererAuthenticationRouteController {
  load(): Promise<void>
  reconcile(): Promise<void>
  acceptSession(session: PublicAuthenticationSession): void
  showUnavailable(forbidden?: boolean): void
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
  let latestRevision: number | undefined

  async function load(): Promise<void> {
    if (disposed) {
      return
    }

    const activeGeneration = generation + 1
    generation = activeGeneration
    latestRevision = undefined
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
      applyUnavailableRouteIfNoSession(activeGeneration)

      return
    }

    try {
      const result = await loadSession(api)

      if (disposed || activeGeneration !== generation) {
        return
      }

      if (!result.ok) {
        applyUnavailableRouteIfNoSession(activeGeneration, result.error.code === 'IPC_FORBIDDEN')
        return
      }

      applySessionRoute(result.data)
    } catch {
      applyUnavailableRouteIfNoSession(activeGeneration)
    }
  }

  async function reconcile(): Promise<void> {
    if (disposed) {
      return
    }

    const activeGeneration = generation

    try {
      const result = await loadSession(api)

      if (disposed || activeGeneration !== generation) {
        return
      }

      if (!result.ok) {
        if (result.error.code === 'IPC_FORBIDDEN') {
          showUnavailable(true)
          return
        }

        applyUnavailableRouteIfNoSession(activeGeneration)
        return
      }

      applySessionRoute(result.data)
    } catch {
      applyUnavailableRouteIfNoSession(activeGeneration)
    }
  }

  function acceptSession(session: PublicAuthenticationSession): void {
    if (disposed) {
      return
    }

    applySessionRoute(session)
  }

  function showUnavailable(forbidden = false): void {
    if (disposed) {
      return
    }

    generation += 1
    latestRevision = undefined
    unsubscribe()
    unsubscribe = noop
    onRoute(createUnavailableRoute(forbidden))
  }

  function applySessionRoute(session: PublicAuthenticationSession): void {
    if (latestRevision !== undefined && session.revision <= latestRevision) {
      return
    }

    latestRevision = session.revision
    onRoute(mapPublicAuthenticationSessionToRoute(session))
  }

  function applyUnavailableRouteIfNoSession(activeGeneration: number, forbidden = false): void {
    if (!disposed && activeGeneration === generation && latestRevision === undefined) {
      onRoute(createUnavailableRoute(forbidden))
    }
  }

  return {
    load,
    reconcile,
    acceptSession,
    showUnavailable,
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
