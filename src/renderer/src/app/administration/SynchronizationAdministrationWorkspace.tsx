import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  LocalUserRole,
  PublicSyncAdministrationActivity,
  PublicSyncAdministrationConfiguration,
  SyncAdministrationErrorCode
} from '@shared/ipc'

interface SynchronizationAdministrationWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly userRole: LocalUserRole
  onAuthenticationFailure(code: SyncAdministrationErrorCode): void
}

type WorkspaceState =
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly configuration: PublicSyncAdministrationConfiguration
      readonly activity: PublicSyncAdministrationActivity
    }
  | { readonly status: 'ERROR'; readonly message: string; readonly retryable: boolean }

const loadingState: WorkspaceState = Object.freeze({ status: 'LOADING' })

export function SynchronizationAdministrationWorkspace({
  api,
  headingId,
  headingRef,
  userRole,
  onAuthenticationFailure
}: SynchronizationAdministrationWorkspaceProps): React.JSX.Element {
  const mountedRef = useRef(true)
  const requestRef = useRef(0)
  const [state, setState] = useState<WorkspaceState>(loadingState)
  const [editing, setEditing] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [installationToken, setInstallationToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadState = useCallback(async (): Promise<void> => {
    if (userRole !== 'LOCAL_ADMIN') return
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setState(loadingState)
    try {
      const result = await api.syncAdministration.getState()
      if (!mountedRef.current || requestRef.current !== requestId) return
      if (!result.ok) {
        handleAuthenticationFailure(result.error.code, onAuthenticationFailure)
        setState({
          status: 'ERROR',
          message: getFailureMessage(result.error.code),
          retryable: isRetryable(result.error.code)
        })
        return
      }
      setState({
        status: 'READY',
        configuration: result.data.configuration,
        activity: result.data.activity
      })
    } catch {
      if (mountedRef.current && requestRef.current === requestId) {
        setState({
          status: 'ERROR',
          message: 'Synchronization status unavailable.',
          retryable: true
        })
      }
    }
  }, [api, onAuthenticationFailure, userRole])

  useEffect(() => {
    mountedRef.current = true
    queueMicrotask(() => {
      if (mountedRef.current) void loadState()
    })
    return () => {
      mountedRef.current = false
      requestRef.current += 1
    }
  }, [loadState])

  const beginEdit = (): void => {
    if (state.status !== 'READY' || saving) return
    setApiBaseUrl(state.configuration.status === 'CONFIGURED' ? state.configuration.apiBaseUrl : '')
    setInstallationToken('')
    setMessage(null)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    if (saving) return
    setApiBaseUrl('')
    setInstallationToken('')
    setMessage(null)
    setEditing(false)
  }

  const saveConfiguration = async (): Promise<void> => {
    if (saving || state.status !== 'READY') return
    setSaving(true)
    setMessage(null)
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    try {
      const result = await api.syncAdministration.configure({ apiBaseUrl, installationToken })
      if (!mountedRef.current || requestRef.current !== requestId) return
      setSaving(false)
      setInstallationToken('')
      if (!result.ok) {
        handleAuthenticationFailure(result.error.code, onAuthenticationFailure)
        setMessage(getFailureMessage(result.error.code))
        return
      }
      setState({
        status: 'READY',
        configuration: result.data.configuration,
        activity: normalizeActivityAfterConfiguration(state.activity)
      })
      setEditing(false)
      setApiBaseUrl('')
      setMessage(
        'Synchronization configuration saved. Background synchronization will continue automatically.'
      )
    } catch {
      if (!mountedRef.current || requestRef.current !== requestId) return
      setSaving(false)
      setInstallationToken('')
      setMessage('Synchronization settings unavailable.')
    }
  }

  if (userRole !== 'LOCAL_ADMIN') {
    return (
      <section className="administration-workspace" aria-labelledby={headingId}>
        <p className="application-workspace-kicker">Administration</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Synchronization Center
        </h1>
        <div className="administration-message administration-message-alert" role="alert">
          Only local administrators can manage synchronization.
        </div>
      </section>
    )
  }

  return (
    <section
      className="administration-workspace sync-administration-workspace"
      aria-labelledby={headingId}
    >
      <div className="administration-section-header">
        <div>
          <p className="application-workspace-kicker">Administration</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Synchronization Center
          </h1>
        </div>
        {state.status === 'READY' ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={saving}
            onClick={() => void loadState()}
          >
            Refresh status
          </button>
        ) : null}
      </div>

      {state.status === 'LOADING' ? (
        <div className="administration-empty-state" role="status">
          Loading synchronization status.
        </div>
      ) : state.status === 'ERROR' ? (
        <div className="administration-empty-state" role="alert">
          <p>{state.message}</p>
          {state.retryable ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void loadState()}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="sync-status-grid" aria-label="Synchronization status summary">
            <StatusCard label="Status" value={activityLabel(state.activity.state)} />
            <StatusCard label="Pending changes" value={String(state.activity.pendingChangeCount)} />
            <StatusCard
              label="Pending acknowledgments"
              value={String(state.activity.pendingAcknowledgmentCount)}
            />
            <StatusCard
              label="Last successful sync"
              value={formatTimestamp(state.activity.lastSuccessfulSyncAt)}
            />
          </div>

          {state.activity.nextRetryAt !== null ? (
            <div className="administration-message" role="status">
              Automatic retry scheduled for {formatTimestamp(state.activity.nextRetryAt)}.
            </div>
          ) : null}

          <section
            className="administration-location-card"
            aria-labelledby="sync-configuration-title"
          >
            <div className="administration-section-header">
              <div>
                <h2 id="sync-configuration-title">Central synchronization</h2>
                <p>
                  Credentials remain protected in the desktop main process and are never displayed.
                </p>
              </div>
              {!editing ? (
                <button className="button button-secondary" type="button" onClick={beginEdit}>
                  {state.configuration.status === 'CONFIGURED'
                    ? 'Update configuration'
                    : 'Configure'}
                </button>
              ) : null}
            </div>

            <div className="administration-definition-list sync-configuration-summary">
              <span>Central server</span>
              <strong>
                {state.configuration.status === 'CONFIGURED'
                  ? state.configuration.apiBaseUrl
                  : 'Not configured'}
              </strong>
              <span>Credential</span>
              <strong>
                {state.configuration.status === 'CONFIGURED'
                  ? `${state.configuration.tokenPrefix}…`
                  : 'Not configured'}
              </strong>
              <span>Last configured</span>
              <strong>
                {state.configuration.status === 'CONFIGURED'
                  ? formatTimestamp(state.configuration.updatedAt)
                  : 'Not configured'}
              </strong>
            </div>

            {editing ? (
              <form
                className="sync-configuration-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveConfiguration()
                }}
              >
                <label className="administration-field" htmlFor="sync-api-base-url">
                  <span>Central API address</span>
                  <input
                    id="sync-api-base-url"
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiBaseUrl}
                    disabled={saving}
                    placeholder="https://sync.example.org"
                    onChange={(event) => setApiBaseUrl(event.currentTarget.value)}
                  />
                </label>
                <label className="administration-field" htmlFor="sync-installation-token">
                  <span>Installation enrollment token</span>
                  <input
                    id="sync-installation-token"
                    type="password"
                    autoComplete="new-password"
                    value={installationToken}
                    disabled={saving}
                    onChange={(event) => setInstallationToken(event.currentTarget.value)}
                  />
                </label>
                <p className="sync-configuration-help">
                  Enter the complete enrollment token each time the configuration is saved.
                </p>
                {message !== null ? (
                  <div className="administration-message administration-message-alert" role="alert">
                    {message}
                  </div>
                ) : null}
                <div className="administration-form-actions">
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={saving || apiBaseUrl.trim() === '' || installationToken === ''}
                  >
                    Save configuration
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={saving}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : message !== null ? (
              <div className="administration-message" role="status">
                {message}
              </div>
            ) : null}
          </section>

          <p className="sync-background-note">
            Synchronization runs automatically at startup and every five minutes when configured.
            There is no manual sync action.
          </p>
        </>
      )}
    </section>
  )
}

function StatusCard({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div className="sync-status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function normalizeActivityAfterConfiguration(
  activity: PublicSyncAdministrationActivity
): PublicSyncAdministrationActivity {
  if (activity.state !== 'NOT_CONFIGURED') return activity
  return {
    ...activity,
    state:
      activity.pendingChangeCount > 0 || activity.pendingAcknowledgmentCount > 0
        ? 'PENDING'
        : 'UP_TO_DATE'
  }
}

function activityLabel(state: PublicSyncAdministrationActivity['state']): string {
  switch (state) {
    case 'NOT_CONFIGURED':
      return 'Not configured'
    case 'UP_TO_DATE':
      return 'Up to date'
    case 'PENDING':
      return 'Waiting to synchronize'
    case 'SYNCHRONIZING':
      return 'Synchronizing'
    case 'RETRY_SCHEDULED':
      return 'Retry scheduled'
  }
}

function formatTimestamp(value: string | null): string {
  if (value === null) return 'Not yet available'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function getFailureMessage(code: SyncAdministrationErrorCode): string {
  switch (code) {
    case 'VALIDATION_FAILED':
      return 'Enter a valid HTTPS server address and installation enrollment token.'
    case 'PROTECTION_UNAVAILABLE':
      return 'Secure credential storage is unavailable on this computer.'
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'Only local administrators can manage synchronization.'
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to manage synchronization.'
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Synchronization settings unavailable.'
  }
}

function isRetryable(code: SyncAdministrationErrorCode): boolean {
  return code === 'IPC_UNAVAILABLE' || code === 'INTERNAL_ERROR'
}

function handleAuthenticationFailure(
  code: SyncAdministrationErrorCode,
  onAuthenticationFailure: (code: SyncAdministrationErrorCode) => void
): void {
  if (
    [
      'IPC_FORBIDDEN',
      'AUTH_LOCKED',
      'AUTH_UNAUTHENTICATED',
      'AUTH_PASSWORD_CHANGE_REQUIRED',
      'AUTHORIZATION_FAILED'
    ].includes(code)
  ) {
    onAuthenticationFailure(code)
  }
}
