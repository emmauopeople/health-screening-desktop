import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  InstallationSettingsErrorCode,
  InstallationSettingsGetConfiguredLocationSuccessData,
  LocalUserRole,
  PublicInstallationSettingsLocation
} from '@shared/ipc'

interface InstallationLocationAdministrationWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly userRole: LocalUserRole
  onAuthenticationFailure(code: InstallationSettingsErrorCode): void
}

type ConfigurationView =
  | { readonly kind: 'NOT_CONFIGURED' }
  | { readonly kind: 'CONFIGURED'; readonly location: PublicInstallationSettingsLocation }
  | { readonly kind: 'LOCATION_NOT_FOUND' }
  | { readonly kind: 'LOCATION_INACTIVE' }

type AdministrationState =
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly configuration: ConfigurationView
      readonly locations: readonly PublicInstallationSettingsLocation[]
    }
  | { readonly status: 'ERROR'; readonly message: string; readonly retryable: boolean }

type EditMode = 'VIEW' | 'EDITING'

const initialAdministrationState: AdministrationState = Object.freeze({ status: 'LOADING' })

export function InstallationLocationAdministrationWorkspace({
  api,
  headingId,
  headingRef,
  userRole,
  onAuthenticationFailure
}: InstallationLocationAdministrationWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const loadRequestRef = useRef(0)
  const mutationRequestRef = useRef(0)
  const pendingSaveRef = useRef(false)
  const [state, setState] = useState<AdministrationState>(initialAdministrationState)
  const [editMode, setEditMode] = useState<EditMode>('VIEW')
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [savePending, setSavePending] = useState(false)

  const loadSettings = useCallback(async (): Promise<void> => {
    if (userRole !== 'LOCAL_ADMIN') {
      return
    }

    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    mutationRequestRef.current += 1
    pendingSaveRef.current = false
    setSavePending(false)
    setEditMode('VIEW')
    setSelectedLocationId('')
    setMessage(null)
    setState(initialAdministrationState)

    try {
      const [configuredResult, locationsResult] = await Promise.all([
        api.installationSettings.getConfiguredLocation(),
        api.installationSettings.listEligibleLocations()
      ])

      if (!mountedRef.current || loadRequestRef.current !== requestId) {
        return
      }

      if (!configuredResult.ok) {
        handleTransportFailure(configuredResult.error.code, onAuthenticationFailure)
        setState({
          status: 'ERROR',
          message: getInstallationSettingsTransportFailureMessage(configuredResult.error.code),
          retryable: isRetryableInstallationSettingsTransportFailure(configuredResult.error.code)
        })
        return
      }

      if (!locationsResult.ok) {
        handleTransportFailure(locationsResult.error.code, onAuthenticationFailure)
        setState({
          status: 'ERROR',
          message: getInstallationSettingsTransportFailureMessage(locationsResult.error.code),
          retryable: isRetryableInstallationSettingsTransportFailure(locationsResult.error.code)
        })
        return
      }

      if (locationsResult.data.status !== 'LISTED') {
        setState({
          status: 'ERROR',
          message: 'Location settings unavailable.',
          retryable: true
        })
        return
      }

      const configuration = mapConfiguredLocation(configuredResult.data)

      if (configuration === null) {
        setState({
          status: 'ERROR',
          message: 'Location settings unavailable.',
          retryable: true
        })
        return
      }

      setState({
        status: 'READY',
        configuration,
        locations: locationsResult.data.locations
      })
    } catch {
      if (!mountedRef.current || loadRequestRef.current !== requestId) {
        return
      }

      setState({
        status: 'ERROR',
        message: 'Location settings unavailable.',
        retryable: true
      })
    }
  }, [api, mountedRef, onAuthenticationFailure, userRole])

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        void loadSettings()
      }
    })

    return () => {
      loadRequestRef.current += 1
      mutationRequestRef.current += 1
      pendingSaveRef.current = false
    }
  }, [loadSettings, mountedRef])

  const beginEdit = useCallback((): void => {
    if (state.status !== 'READY' || savePending) {
      return
    }

    setEditMode('EDITING')
    setSelectedLocationId('')
    setMessage(null)
  }, [savePending, state.status])

  const cancelEdit = useCallback((): void => {
    if (savePending) {
      return
    }

    setEditMode('VIEW')
    setSelectedLocationId('')
    setMessage(null)
  }, [savePending])

  const saveLocation = useCallback(async (): Promise<void> => {
    if (state.status !== 'READY' || pendingSaveRef.current) {
      return
    }

    const selectedLocation = state.locations.find((location) => location.id === selectedLocationId)

    if (selectedLocation === undefined) {
      setMessage('Select a location.')
      return
    }

    const requestId = mutationRequestRef.current + 1
    mutationRequestRef.current = requestId
    pendingSaveRef.current = true
    setSavePending(true)
    setMessage(null)

    try {
      const result =
        state.configuration.kind === 'NOT_CONFIGURED'
          ? await api.installationSettings.assignInitialLocation({
              locationId: selectedLocation.id
            })
          : await api.installationSettings.reconfigureLocation({
              locationId: selectedLocation.id
            })

      if (!mountedRef.current || mutationRequestRef.current !== requestId) {
        return
      }

      pendingSaveRef.current = false
      setSavePending(false)

      if (!result.ok) {
        handleTransportFailure(result.error.code, onAuthenticationFailure)
        setMessage(getInstallationSettingsTransportFailureMessage(result.error.code))
        return
      }

      if (
        result.data.status === 'ASSIGNED' ||
        result.data.status === 'UPDATED' ||
        result.data.status === 'UNCHANGED'
      ) {
        setState({
          status: 'READY',
          configuration: { kind: 'CONFIGURED', location: result.data.location },
          locations: state.locations
        })
        setEditMode('VIEW')
        setSelectedLocationId('')
        setMessage(
          result.data.status === 'UNCHANGED'
            ? 'Assigned location unchanged.'
            : 'Assigned location updated.'
        )
        return
      }

      setMessage(getInstallationSettingsCommandFailureMessage(result.data.status))
    } catch {
      if (!mountedRef.current || mutationRequestRef.current !== requestId) {
        return
      }

      pendingSaveRef.current = false
      setSavePending(false)
      setMessage('Location settings unavailable.')
    }
  }, [
    api,
    mountedRef,
    onAuthenticationFailure,
    selectedLocationId,
    state,
    setMessage,
    setSavePending
  ])

  if (userRole !== 'LOCAL_ADMIN') {
    return (
      <section className="administration-workspace" aria-labelledby={headingId}>
        <p className="application-workspace-kicker">Administration</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Administration
        </h1>
        <div className="administration-message administration-message-alert" role="alert">
          Only local administrators can configure the installation location.
        </div>
      </section>
    )
  }

  const selectedLocation =
    state.status === 'READY'
      ? state.locations.find((location) => location.id === selectedLocationId)
      : undefined
  const assignmentAction =
    state.status === 'READY' && state.configuration.kind === 'NOT_CONFIGURED'
      ? 'Assign location'
      : 'Change location'

  return (
    <section className="administration-workspace" aria-labelledby={headingId}>
      <p className="application-workspace-kicker">Administration</p>
      <h1 ref={headingRef} id={headingId} tabIndex={-1}>
        Administration
      </h1>

      <section className="administration-location-card" aria-labelledby="screening-location-title">
        <div className="administration-section-header">
          <div>
            <h2 id="screening-location-title">Screening Location</h2>
          </div>
          {state.status === 'READY' && editMode === 'VIEW' ? (
            <button className="button button-secondary" type="button" onClick={beginEdit}>
              {assignmentAction}
            </button>
          ) : null}
        </div>

        {state.status === 'LOADING' ? (
          <div className="administration-empty-state" role="status">
            Loading location settings.
          </div>
        ) : state.status === 'ERROR' ? (
          <div className="administration-empty-state" role="alert">
            <p>{state.message}</p>
            {state.retryable ? (
              <button className="button button-secondary" type="button" onClick={loadSettings}>
                Retry
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="administration-definition-list">
              <span>Assigned location</span>
              <strong>{getAssignedLocationText(state.configuration)}</strong>
            </div>

            {editMode === 'EDITING' ? (
              <form
                className="administration-location-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveLocation()
                }}
              >
                <label className="administration-field" htmlFor="installation-location-select">
                  <span>{assignmentAction}</span>
                  <select
                    id="installation-location-select"
                    value={selectedLocationId}
                    disabled={savePending || state.locations.length === 0}
                    onChange={(event) => setSelectedLocationId(event.currentTarget.value)}
                  >
                    <option value="">Select location</option>
                    {state.locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                {state.locations.length === 0 ? (
                  <div className="administration-message" role="status">
                    No active locations available.
                  </div>
                ) : null}

                {selectedLocation !== undefined ? (
                  <div className="administration-confirmation" role="status">
                    <strong>{selectedLocation.name}</strong>
                    <span>
                      This installation will use the new location for future screening work.
                    </span>
                  </div>
                ) : null}

                {message !== null ? (
                  <div className="administration-message administration-message-alert" role="alert">
                    {message}
                  </div>
                ) : null}

                <div className="administration-form-actions">
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={savePending || selectedLocation === undefined}
                  >
                    Save
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={savePending}
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
          </>
        )}
      </section>
    </section>
  )
}

function mapConfiguredLocation(
  data: InstallationSettingsGetConfiguredLocationSuccessData
): ConfigurationView | null {
  switch (data.status) {
    case 'RESOLVED':
      return { kind: 'CONFIGURED', location: data.location }
    case 'LOCATION_NOT_CONFIGURED':
      return { kind: 'NOT_CONFIGURED' }
    case 'LOCATION_NOT_FOUND':
      return { kind: 'LOCATION_NOT_FOUND' }
    case 'LOCATION_INACTIVE':
      return { kind: 'LOCATION_INACTIVE' }
    case 'UNAVAILABLE':
      return null
  }
}

function getAssignedLocationText(configuration: ConfigurationView): string {
  switch (configuration.kind) {
    case 'CONFIGURED':
      return configuration.location.name
    case 'NOT_CONFIGURED':
      return 'Not configured'
    case 'LOCATION_NOT_FOUND':
      return 'Configured location not found'
    case 'LOCATION_INACTIVE':
      return 'Configured location inactive'
  }
}

function getInstallationSettingsCommandFailureMessage(status: string): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'Only local administrators can configure the installation location.'
    case 'VALIDATION_FAILED':
      return 'Select a location.'
    case 'LOCATION_NOT_CONFIGURED':
      return 'Screening location is not configured.'
    case 'LOCATION_NOT_FOUND':
      return 'Selected location could not be found.'
    case 'LOCATION_INACTIVE':
      return 'Selected location is inactive.'
    case 'LOCATION_ALREADY_CONFIGURED':
      return 'Location is already configured.'
    case 'ACTIVE_SCREENING_WORK':
      return 'Location cannot be changed while screening work is active.'
    case 'CONFIGURATION_CONFLICT':
    case 'UNAVAILABLE':
      return 'Location settings unavailable.'
    default:
      return 'Location settings unavailable.'
  }
}

function getInstallationSettingsTransportFailureMessage(
  code: InstallationSettingsErrorCode
): string {
  switch (code) {
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'Only local administrators can configure the installation location.'
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to configure the installation location.'
    case 'VALIDATION_FAILED':
      return 'The location settings request could not be processed.'
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Location settings unavailable.'
  }
}

function isRetryableInstallationSettingsTransportFailure(
  code: InstallationSettingsErrorCode
): boolean {
  return code === 'IPC_UNAVAILABLE' || code === 'INTERNAL_ERROR'
}

function handleTransportFailure(
  code: InstallationSettingsErrorCode,
  onAuthenticationFailure: (code: InstallationSettingsErrorCode) => void
): void {
  if (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  ) {
    onAuthenticationFailure(code)
  }
}

function useMountedRef(): RefObject<boolean> {
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  return mountedRef
}
