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

function App({ api = window.healthScreening }: AppProps): React.JSX.Element {
  const { startupState, retryStartupLoad, setStartupState } = useStartupState(api)
  const handleExit = useCallback(() => {
    window.close()
  }, [])
  const rootClassName =
    startupState.status === 'SETUP_COMPLETE' ? 'application-root' : 'foundation-shell setup-shell'

  return (
    <div className={rootClassName}>
      {startupState.status === 'LOADING' ? <LoadingScreen /> : null}
      {startupState.status === 'SETUP_REQUIRED' ? (
        <FirstRunSetupScreen
          api={api}
          state={startupState}
          onStartupState={setStartupState}
          onExit={handleExit}
        />
      ) : null}
      {startupState.status === 'SETUP_COMPLETE' ? (
        <AuthenticationBoundary
          api={api}
          shellContext={createApplicationShellContext(startupState)}
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

  useEffect(() => {
    void controller.load()

    return () => {
      controller.dispose()
    }
  }, [controller])

  return (
    <AuthenticationExperience
      api={api}
      route={route}
      controller={controller}
      shellContext={shellContext}
      onExit={onExit}
    />
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
