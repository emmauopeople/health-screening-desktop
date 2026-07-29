import { useEffect, useState } from 'react'
import type { AppGetHealthResult, AppGetInfoResult, AppHealth, AppInfo } from '@shared/ipc'

type AppLoadState =
  | {
      status: 'loading'
    }
  | {
      status: 'ready'
      info: AppInfo
      health: AppHealth
    }
  | {
      status: 'error'
      message: string
    }

const fallbackApplicationName: AppInfo['applicationName'] = 'Health Screening Offline Desktop'

function App(): React.JSX.Element {
  const [loadState, setLoadState] = useState<AppLoadState>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    async function loadFoundationState(): Promise<void> {
      const [infoResult, healthResult] = await Promise.all([
        window.healthScreening.app.getInfo(),
        window.healthScreening.app.getHealth()
      ])

      if (!isMounted) {
        return
      }

      if (infoResult.ok && healthResult.ok) {
        setLoadState({
          status: 'ready',
          info: infoResult.data,
          health: healthResult.data
        })
        return
      }

      setLoadState({
        status: 'error',
        message: getSafeFailureMessage(infoResult, healthResult)
      })
    }

    void loadFoundationState().catch(() => {
      if (isMounted) {
        setLoadState({
          status: 'error',
          message: 'The desktop service is unavailable.'
        })
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  const applicationName =
    loadState.status === 'ready' ? loadState.info.applicationName : fallbackApplicationName

  return (
    <main className="foundation-shell" aria-labelledby="application-title">
      <section className="foundation-panel">
        <div className="foundation-eyebrow">Engineering foundation</div>
        <h1 id="application-title">{applicationName}</h1>
        <p className="foundation-statement">No clinical features are implemented yet.</p>
        <p className="foundation-metadata" aria-live="polite">
          {getMetadataText(loadState)}
        </p>
        {loadState.status === 'error' ? (
          <p className="foundation-error" role="status">
            {loadState.message}
          </p>
        ) : null}
        <dl className="foundation-status" aria-label="Shell foundation status">
          <div>
            <dt>Clinical workflows</dt>
            <dd>{getClinicalFeatureText(loadState)}</dd>
          </div>
          <div>
            <dt>Database</dt>
            <dd>{getDatabaseText(loadState)}</dd>
          </div>
          <div>
            <dt>Desktop IPC</dt>
            <dd>{getIpcText(loadState)}</dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

function getSafeFailureMessage(
  infoResult: AppGetInfoResult,
  healthResult: AppGetHealthResult
): string {
  if (!infoResult.ok) {
    return infoResult.error.message
  }

  if (!healthResult.ok) {
    return healthResult.error.message
  }

  return 'The desktop service is unavailable.'
}

function getMetadataText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') {
    return 'Loading desktop service status.'
  }

  if (loadState.status === 'error') {
    return 'Desktop service status could not be loaded.'
  }

  const runtime = loadState.info.packaged ? 'packaged preview' : 'development runtime'

  return `Version ${loadState.info.applicationVersion} | ${loadState.info.platform}/${loadState.info.architecture} | ${runtime}`
}

function getClinicalFeatureText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') {
    return 'Loading'
  }

  if (loadState.status === 'error') {
    return 'Unavailable'
  }

  return loadState.health.clinicalFeatures === 'not-implemented' ? 'Not implemented' : 'Unavailable'
}

function getDatabaseText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') {
    return 'Loading'
  }

  if (loadState.status === 'error') {
    return 'Unavailable'
  }

  return loadState.health.database === 'not-configured' ? 'Not configured' : 'Unavailable'
}

function getIpcText(loadState: AppLoadState): string {
  if (loadState.status === 'loading') {
    return 'Loading'
  }

  if (loadState.status === 'error') {
    return 'Unavailable'
  }

  return loadState.health.ipc === 'available' ? 'Available' : 'Unavailable'
}

export default App
