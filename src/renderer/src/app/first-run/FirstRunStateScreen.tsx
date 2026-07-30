import type { AppHealth, AppInfo } from '@shared/ipc'

import {
  createSetupCompleteViewModel,
  firstRunScreenCopy,
  mapInconsistencyMessage
} from './first-run-controller'
import { fallbackApplicationName, type RendererStartupState } from './first-run-types'
import {
  getClinicalFeatureText,
  getDatabaseText,
  getIpcText,
  type AppLoadState
} from '../status-mapping'

interface LoadingScreenProps {
  applicationName?: AppInfo['applicationName']
}

export function LoadingScreen({
  applicationName = fallbackApplicationName
}: LoadingScreenProps): React.JSX.Element {
  return (
    <section className="foundation-panel" aria-live="polite" aria-busy="true">
      <div className="foundation-eyebrow">Local setup</div>
      <h1>{applicationName}</h1>
      <p className="foundation-statement">{firstRunScreenCopy.loadingStatus}</p>
    </section>
  )
}

interface SetupCompleteScreenProps {
  state: Extract<RendererStartupState, { status: 'SETUP_COMPLETE' }>
  onExit(): void
}

export function SetupCompleteScreen({
  state,
  onExit
}: SetupCompleteScreenProps): React.JSX.Element {
  const viewModel = createSetupCompleteViewModel(state)

  return (
    <section className="foundation-panel setup-panel" aria-labelledby="setup-complete-heading">
      <div className="foundation-eyebrow">Local setup</div>
      <h1 id="setup-complete-heading">{viewModel.heading}</h1>
      <dl className="setup-result-list" aria-label="Completed setup details">
        <div>
          <dt>Deployment</dt>
          <dd>{viewModel.deploymentName}</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{viewModel.timeZone}</dd>
        </div>
      </dl>
      <p className="foundation-statement">{viewModel.statement}</p>
      <ShellStatusSummary info={state.info} health={state.health} />
      <div className="setup-actions">
        <button className="button button-secondary" type="button" onClick={onExit}>
          {firstRunScreenCopy.exitLabel}
        </button>
      </div>
    </section>
  )
}

interface InconsistentStateScreenProps {
  state: Extract<RendererStartupState, { status: 'INCONSISTENT' }>
  onExit(): void
}

export function InconsistentStateScreen({
  state,
  onExit
}: InconsistentStateScreenProps): React.JSX.Element {
  return (
    <section className="foundation-panel setup-panel" aria-labelledby="inconsistent-state-heading">
      <div className="foundation-eyebrow">Local setup</div>
      <h1 id="inconsistent-state-heading">{firstRunScreenCopy.inconsistentHeading}</h1>
      <p className="foundation-statement">{mapInconsistencyMessage(state.code)}</p>
      <p className="setup-reference">
        Support reference: <code>{state.code}</code>
      </p>
      <ShellStatusSummary info={state.info} health={state.health} />
      <div className="setup-actions">
        <button className="button button-secondary" type="button" onClick={onExit}>
          {firstRunScreenCopy.exitLabel}
        </button>
      </div>
    </section>
  )
}

interface UnavailableScreenProps {
  state: Extract<RendererStartupState, { status: 'UNAVAILABLE' }>
  onRetry(): void
  onExit(): void
}

export function UnavailableScreen({
  state,
  onRetry,
  onExit
}: UnavailableScreenProps): React.JSX.Element {
  return (
    <section className="foundation-panel setup-panel" aria-labelledby="unavailable-heading">
      <div className="foundation-eyebrow">Local setup</div>
      <h1 id="unavailable-heading">{firstRunScreenCopy.unavailableHeading}</h1>
      <p className="foundation-statement">{state.message}</p>
      <div className="setup-actions">
        {state.canRetry ? (
          <button className="button button-primary" type="button" onClick={onRetry}>
            {firstRunScreenCopy.retryLabel}
          </button>
        ) : null}
        <button className="button button-secondary" type="button" onClick={onExit}>
          {firstRunScreenCopy.exitLabel}
        </button>
      </div>
    </section>
  )
}

interface ShellStatusSummaryProps {
  info: AppInfo
  health: AppHealth
}

export function ShellStatusSummary({ info, health }: ShellStatusSummaryProps): React.JSX.Element {
  const loadState: AppLoadState = { status: 'ready', info, health }
  const runtime = info.packaged ? 'packaged preview' : 'development runtime'

  return (
    <div className="setup-status-summary">
      <p className="foundation-metadata">
        Version {info.applicationVersion} | {info.platform}/{info.architecture} | {runtime}
      </p>
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
    </div>
  )
}
