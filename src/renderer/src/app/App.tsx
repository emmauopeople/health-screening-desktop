import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  AuthenticationExperience,
  createRendererAuthenticationRouteController,
  type RendererAuthenticationRouteController,
  type RendererAuthenticationRoute
} from './authentication'
import { FirstRunSetupScreen } from './first-run/FirstRunSetupScreen'
import {
  InconsistentStateScreen,
  LoadingScreen,
  UnavailableScreen
} from './first-run/FirstRunStateScreen'
import {
  createRendererStartupStateGate,
  type RendererStartupStateGate
} from './first-run/first-run-controller'
import type { RendererStartupState } from './first-run/first-run-types'
import type { ApplicationShellContext } from './shell'

interface AppProps {
  api?: HealthScreeningApi
}

interface PendingAuthenticationControllerDisposal {
  readonly controller: RendererAuthenticationRouteController
  readonly timeoutId: ReturnType<typeof setTimeout>
}

function App({ api = window.healthScreening }: AppProps): React.JSX.Element {
  const { startupState, retryStartupLoad, setStartupState } = useStartupState(api)
  const handleExit = useCallback(() => {
    window.close()
  }, [])

  if (startupState.status === 'SETUP_COMPLETE') {
    return (
      <AuthenticationBoundary
        api={api}
        shellContext={createApplicationShellContext(startupState)}
        onExit={handleExit}
      />
    )
  }

  return (
    <div className="foundation-shell setup-shell">
      {startupState.status === 'LOADING' ? <LoadingScreen /> : null}
      {startupState.status === 'SETUP_REQUIRED' ? (
        <FirstRunSetupScreen
          api={api}
          state={startupState}
          onStartupState={setStartupState}
          onExit={handleExit}
        />
      ) : null}
      {startupState.status === 'INCONSISTENT' ? (
        <InconsistentStateScreen state={startupState} onExit={handleExit} />
      ) : null}
      {startupState.status === 'UNAVAILABLE' ? (
        <UnavailableScreen state={startupState} onRetry={retryStartupLoad} onExit={handleExit} />
      ) : null}
    </div>
  )
}

function AuthenticationBoundary({
  api,
  shellContext,
  onExit
}: {
  api: HealthScreeningApi
  shellContext: ApplicationShellContext
  onExit(): void
}): React.JSX.Element {
  const [route, setRoute] = useState<RendererAuthenticationRoute>({ status: 'AUTH_LOADING' })
  const controller = useMemo<RendererAuthenticationRouteController>(
    () =>
      createRendererAuthenticationRouteController({
        api,
        onRoute: setRoute
      }),
    [api]
  )
  const pendingDisposalRef = useRef<PendingAuthenticationControllerDisposal | null>(null)

  useEffect(() => {
    const pendingDisposal = pendingDisposalRef.current

    if (pendingDisposal !== null) {
      clearTimeout(pendingDisposal.timeoutId)
      pendingDisposalRef.current = null

      if (pendingDisposal.controller !== controller) {
        pendingDisposal.controller.dispose()
      }
    }

    void controller.load()

    return () => {
      const pendingDisposal: PendingAuthenticationControllerDisposal = {
        controller,
        timeoutId: setTimeout(() => {
          if (pendingDisposalRef.current === pendingDisposal) {
            pendingDisposalRef.current = null
            controller.dispose()
          }
        }, 0)
      }

      pendingDisposalRef.current = pendingDisposal
    }
  }, [controller])

  const rootClassName =
    route.status === 'SESSION_ACTIVE'
      ? 'application-root'
      : route.status === 'LOGIN_REQUIRED'
        ? 'auth-login-root'
        : route.status === 'SESSION_LOCKED'
          ? 'auth-login-root'
          : 'foundation-shell setup-shell'

  return (
    <div className={rootClassName}>
      <AuthenticationExperience
        api={api}
        route={route}
        controller={controller}
        shellContext={shellContext}
        onExit={onExit}
      />
    </div>
  )
}

function createApplicationShellContext(
  state: Extract<RendererStartupState, { status: 'SETUP_COMPLETE' }>
): ApplicationShellContext {
  return {
    applicationName: state.info.applicationName,
    applicationVersion: state.info.applicationVersion,
    deploymentName: state.deploymentName,
    timeZone: state.timeZone
  }
}

function useStartupState(api: HealthScreeningApi): {
  startupState: RendererStartupState
  retryStartupLoad(): void
  setStartupState(state: RendererStartupState): void
} {
  const [startupState, setStartupState] = useState<RendererStartupState>({ status: 'LOADING' })
  const gateRef = useRef<RendererStartupStateGate | null>(null)

  useEffect(() => {
    const gate = createRendererStartupStateGate({
      api,
      onState: setStartupState
    })

    gateRef.current = gate
    void gate.load()

    return () => {
      gate.dispose()

      if (gateRef.current === gate) {
        gateRef.current = null
      }
    }
  }, [api])

  const retryStartupLoad = useCallback(() => {
    void gateRef.current?.load()
  }, [])

  return { startupState, retryStartupLoad, setStartupState }
}

export default App
