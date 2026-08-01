import { useEffect } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import { AuthenticatedShell } from './AuthenticatedShell'
import { AuthenticationLoadingScreen } from './AuthenticationLoadingScreen'
import { AuthenticationUnavailableScreen } from './AuthenticationUnavailableScreen'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import {
  createAuthenticationActivityReporter,
  createAuthenticationDeadlineReconciler
} from './authentication-session-runtime'
import { LockedSessionScreen } from './LockedSessionScreen'
import { LoginScreen } from './LoginScreen'
import { RequiredPasswordChangeScreen } from './RequiredPasswordChangeScreen'

interface AuthenticationExperienceProps {
  readonly api: HealthScreeningApi
  readonly route: RendererAuthenticationRoute
  readonly controller: RendererAuthenticationRouteController
  onExit(): void
}

export function AuthenticationExperience({
  api,
  route,
  controller,
  onExit
}: AuthenticationExperienceProps): React.JSX.Element {
  const activeRevision = route.status === 'SESSION_ACTIVE' ? route.revision : undefined

  useEffect(() => {
    if (route.status !== 'SESSION_ACTIVE') {
      return undefined
    }

    const reporter = createAuthenticationActivityReporter({ api, controller })

    return () => {
      reporter.dispose()
    }
  }, [api, controller, route.status, activeRevision])

  useEffect(() => {
    if (
      route.status !== 'PASSWORD_CHANGE_REQUIRED' &&
      route.status !== 'SESSION_ACTIVE' &&
      route.status !== 'SESSION_LOCKED'
    ) {
      return undefined
    }

    const reconciler = createAuthenticationDeadlineReconciler({ route, controller })

    return () => {
      reconciler.dispose()
    }
  }, [controller, route])

  switch (route.status) {
    case 'AUTH_LOADING':
      return <AuthenticationLoadingScreen />
    case 'AUTH_UNAVAILABLE':
      return (
        <AuthenticationUnavailableScreen route={route} controller={controller} onExit={onExit} />
      )
    case 'LOGIN_REQUIRED':
      return <LoginScreen api={api} controller={controller} onExit={onExit} />
    case 'PASSWORD_CHANGE_REQUIRED':
      return <RequiredPasswordChangeScreen api={api} route={route} controller={controller} />
    case 'SESSION_LOCKED':
      return <LockedSessionScreen api={api} route={route} controller={controller} />
    case 'SESSION_ACTIVE':
      return <AuthenticatedShell api={api} route={route} controller={controller} />
  }
}
