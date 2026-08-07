import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject
} from 'react'

import type {
  HealthScreeningApi,
  PatientErrorCode,
  PublicPatientSummary,
  PublicScreeningEncounterStartSummary,
  PublicScreeningSession,
  PublicScreeningSessionWorkspaceLocation,
  ScreeningSessionErrorCode
} from '@shared/ipc'

import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import {
  formatPatientContact,
  formatPatientDemographicSummary,
  getEncounterStartMessage,
  getInitials,
  getPatientFailureMessage,
  getPatientTabLabel,
  getSessionFailureMessage,
  isProtectedPatientFailure,
  isProtectedSessionFailure,
  screeningSteps,
  type ScreeningStepId
} from './screening-workspace-model'

interface ScreeningWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onScreeningAuthenticationFailure(code: PatientErrorCode | ScreeningSessionErrorCode): void
  registerNavigationGuard(guard: WorkspaceNavigationGuard | null): void
}

type WorkspaceContextState =
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly deploymentLocalDate: string
      readonly activeLocations: readonly PublicScreeningSessionWorkspaceLocation[]
    }
  | { readonly status: 'ERROR'; readonly message: string }

type SearchState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly items: readonly PublicPatientSummary[] }
  | { readonly status: 'EMPTY' }
  | { readonly status: 'ERROR'; readonly message: string }

type SessionState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly items: readonly PublicScreeningSession[] }
  | { readonly status: 'EMPTY' }
  | { readonly status: 'ERROR'; readonly message: string }

interface PatientWorkspaceTab {
  readonly patient: PublicPatientSummary
  readonly activeStep: ScreeningStepId
  readonly encounter: PublicScreeningEncounterStartSummary | null
}

type WorkspaceMessage = {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
}

const emptySearchState: SearchState = Object.freeze({ status: 'IDLE' })
const emptySessionState: SessionState = Object.freeze({ status: 'IDLE' })
const maxOpenPatientTabs = 4

export function ScreeningWorkspace({
  api,
  headingId,
  headingRef,
  onScreeningAuthenticationFailure,
  registerNavigationGuard
}: ScreeningWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const contextRequestRef = useRef(0)
  const sessionRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const startRequestRef = useRef(0)
  const encounterPendingRef = useRef(false)
  const messageRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [contextState, setContextState] = useState<WorkspaceContextState>({ status: 'LOADING' })
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>(emptySessionState)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [patientQuery, setPatientQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>(emptySearchState)
  const [patientTabs, setPatientTabs] = useState<readonly PatientWorkspaceTab[]>([])
  const [activePatientId, setActivePatientId] = useState<string | null>(null)
  const [message, setMessage] = useState<WorkspaceMessage | null>(null)
  const [encounterPending, setEncounterPending] = useState(false)

  const activePatientTab = patientTabs.find((tab) => tab.patient.id === activePatientId) ?? null
  const effectiveSessionState =
    contextState.status === 'READY' && selectedLocationId !== null
      ? sessionState
      : emptySessionState
  const selectedSession =
    effectiveSessionState.status === 'READY'
      ? (effectiveSessionState.items.find((session) => session.id === selectedSessionId) ?? null)
      : null
  const selectedLocation =
    contextState.status === 'READY'
      ? (contextState.activeLocations.find((location) => location.id === selectedLocationId) ??
        null)
      : null
  const activeStepLabel =
    activePatientTab === null
      ? null
      : (screeningSteps.find((step) => step.id === activePatientTab.activeStep)?.label ?? 'Vitals')

  const focusMessage = useCallback((): void => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        messageRef.current?.focus({ preventScroll: true })
      }
    })
  }, [mountedRef])

  const setWorkspaceMessage = useCallback(
    (nextMessage: WorkspaceMessage): void => {
      setMessage(nextMessage)
      focusMessage()
    },
    [focusMessage]
  )

  const clearWorkspace = useCallback((): void => {
    contextRequestRef.current += 1
    sessionRequestRef.current += 1
    searchRequestRef.current += 1
    startRequestRef.current += 1
    encounterPendingRef.current = false
    setContextState({ status: 'LOADING' })
    setSelectedLocationId(null)
    setSessionState(emptySessionState)
    setSelectedSessionId(null)
    setPatientQuery('')
    setSearchState(emptySearchState)
    setPatientTabs([])
    setActivePatientId(null)
    setEncounterPending(false)
  }, [])

  const handlePatientFailure = useCallback(
    (code: PatientErrorCode): void => {
      const text = getPatientFailureMessage(code)

      if (isProtectedPatientFailure(code)) {
        clearWorkspace()
        onScreeningAuthenticationFailure(code)
      }

      setWorkspaceMessage({ tone: 'ALERT', text })
    },
    [clearWorkspace, onScreeningAuthenticationFailure, setWorkspaceMessage]
  )

  const handleSessionFailure = useCallback(
    (code: ScreeningSessionErrorCode): void => {
      const text = getSessionFailureMessage(code)

      if (isProtectedSessionFailure(code)) {
        clearWorkspace()
        onScreeningAuthenticationFailure(code)
      }

      setWorkspaceMessage({ tone: 'ALERT', text })
    },
    [clearWorkspace, onScreeningAuthenticationFailure, setWorkspaceMessage]
  )

  const loadCurrentSessions = useCallback(
    async (locationId: string, deploymentLocalDate: string): Promise<void> => {
      const requestId = sessionRequestRef.current + 1
      sessionRequestRef.current = requestId
      setSessionState({ status: 'LOADING' })

      try {
        const result = await api.screeningSessions.list({
          locationId,
          status: 'OPEN',
          dateFrom: deploymentLocalDate,
          dateTo: deploymentLocalDate,
          page: 1,
          pageSize: 25
        })

        if (!mountedRef.current || sessionRequestRef.current !== requestId) {
          return
        }

        if (!result.ok) {
          handleSessionFailure(result.error.code)
          setSessionState({ status: 'ERROR', message: getSessionFailureMessage(result.error.code) })
          return
        }

        const currentSessions = result.data.items.filter(
          (session) =>
            session.status === 'OPEN' &&
            session.locationId === locationId &&
            session.sessionDate === deploymentLocalDate
        )

        if (currentSessions.length === 0) {
          setSessionState({ status: 'EMPTY' })
          setSelectedSessionId(null)
          return
        }

        setSessionState({ status: 'READY', items: currentSessions })
        setSelectedSessionId((currentSessionId) => {
          if (currentSessionId !== null) {
            const retainedSession = currentSessions.find(
              (session) => session.id === currentSessionId
            )

            if (retainedSession !== undefined) {
              return retainedSession.id
            }
          }

          return currentSessions.length === 1 ? (currentSessions[0]?.id ?? null) : null
        })
      } catch {
        if (mountedRef.current && sessionRequestRef.current === requestId) {
          const text = getSessionFailureMessage('IPC_UNAVAILABLE')
          setSessionState({ status: 'ERROR', message: text })
          setWorkspaceMessage({ tone: 'ALERT', text })
        }
      }
    },
    [api, handleSessionFailure, mountedRef, setWorkspaceMessage]
  )

  const loadContext = useCallback(
    async (options?: { readonly preserveMessage?: boolean }): Promise<void> => {
      const requestId = contextRequestRef.current + 1
      contextRequestRef.current = requestId
      setContextState({ status: 'LOADING' })

      if (options?.preserveMessage !== true) {
        setMessage(null)
      }

      try {
        const result = await api.screeningSessions.getWorkspaceContext()

        if (!mountedRef.current || contextRequestRef.current !== requestId) {
          return
        }

        if (!result.ok) {
          handleSessionFailure(result.error.code)
          setContextState({ status: 'ERROR', message: getSessionFailureMessage(result.error.code) })
          return
        }

        const nextState: Extract<WorkspaceContextState, { readonly status: 'READY' }> = {
          status: 'READY',
          deploymentLocalDate: result.data.deploymentLocalDate,
          activeLocations: result.data.activeLocations
        }

        setContextState(nextState)
        setSelectedLocationId((currentLocationId) => {
          if (
            currentLocationId !== null &&
            result.data.activeLocations.some((location) => location.id === currentLocationId)
          ) {
            return currentLocationId
          }

          return result.data.activeLocations.length === 1
            ? (result.data.activeLocations[0]?.id ?? null)
            : null
        })
      } catch {
        if (mountedRef.current && contextRequestRef.current === requestId) {
          const text = getSessionFailureMessage('IPC_UNAVAILABLE')
          setContextState({ status: 'ERROR', message: text })
          setWorkspaceMessage({ tone: 'ALERT', text })
        }
      }
    },
    [api, handleSessionFailure, mountedRef, setWorkspaceMessage]
  )

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        void loadContext()
      }
    })
  }, [loadContext, mountedRef])

  useEffect(() => {
    registerNavigationGuard(null)

    return () => {
      registerNavigationGuard(null)
    }
  }, [registerNavigationGuard])

  useEffect(() => {
    if (contextState.status === 'READY' && selectedLocationId !== null) {
      const nextLocationId = selectedLocationId
      const nextDeploymentLocalDate = contextState.deploymentLocalDate

      queueMicrotask(() => {
        if (mountedRef.current) {
          void loadCurrentSessions(nextLocationId, nextDeploymentLocalDate)
        }
      })
    }
  }, [contextState, loadCurrentSessions, mountedRef, selectedLocationId])

  const searchPatients = useCallback(async (): Promise<void> => {
    const query = patientQuery.trim()

    if (query.length === 0) {
      setSearchState({ status: 'ERROR', message: 'Enter a patient search term.' })
      setWorkspaceMessage({ tone: 'ALERT', text: 'Enter a patient search term.' })
      return
    }

    const requestId = searchRequestRef.current + 1
    searchRequestRef.current = requestId
    setSearchState({ status: 'LOADING' })

    try {
      const result = await api.patient.search({ query, page: 1, pageSize: 25 })

      if (!mountedRef.current || searchRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        handlePatientFailure(result.error.code)
        setSearchState({ status: 'ERROR', message: getPatientFailureMessage(result.error.code) })
        return
      }

      setSearchState(
        result.data.items.length === 0
          ? { status: 'EMPTY' }
          : { status: 'READY', items: result.data.items }
      )
    } catch {
      if (mountedRef.current && searchRequestRef.current === requestId) {
        const text = getPatientFailureMessage('IPC_UNAVAILABLE')
        setSearchState({ status: 'ERROR', message: text })
        setWorkspaceMessage({ tone: 'ALERT', text })
      }
    }
  }, [api, handlePatientFailure, mountedRef, patientQuery, setWorkspaceMessage])

  const focusPatientTab = useCallback((patientId: string): void => {
    queueMicrotask(() => {
      tabRefs.current.get(patientId)?.focus({ preventScroll: true })
    })
  }, [])

  const openPatientTab = useCallback(
    (patient: PublicPatientSummary): void => {
      const existingTab = patientTabs.find((tab) => tab.patient.id === patient.id)

      if (existingTab !== undefined) {
        setActivePatientId(patient.id)
        focusPatientTab(patient.id)
        return
      }

      if (patientTabs.length >= maxOpenPatientTabs) {
        setWorkspaceMessage({
          tone: 'ALERT',
          text: 'Close one of the four open patient tabs before opening another patient.'
        })
        return
      }

      setPatientTabs((currentTabs) => [
        ...currentTabs,
        { patient, activeStep: 'VITALS', encounter: null }
      ])
      setActivePatientId(patient.id)
      focusPatientTab(patient.id)
    },
    [focusPatientTab, patientTabs, setWorkspaceMessage]
  )

  const closePatientTab = useCallback(
    (patientId: string): void => {
      setPatientTabs((currentTabs) => {
        const closingIndex = currentTabs.findIndex((tab) => tab.patient.id === patientId)

        if (closingIndex < 0) {
          return currentTabs
        }

        const nextTabs = currentTabs.filter((tab) => tab.patient.id !== patientId)

        setActivePatientId((currentActivePatientId) => {
          if (currentActivePatientId !== patientId) {
            return currentActivePatientId
          }

          const nextTab = nextTabs[Math.min(closingIndex, nextTabs.length - 1)] ?? null
          const nextPatientId = nextTab?.patient.id ?? null

          if (nextPatientId !== null) {
            focusPatientTab(nextPatientId)
          } else {
            headingRef.current?.focus({ preventScroll: true })
          }

          return nextPatientId
        })

        return nextTabs
      })
    },
    [focusPatientTab, headingRef]
  )

  const updateActivePatientStep = useCallback(
    (stepId: ScreeningStepId): void => {
      if (activePatientId === null) {
        return
      }

      setPatientTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.patient.id === activePatientId ? { ...tab, activeStep: stepId } : tab
        )
      )
    },
    [activePatientId]
  )

  const startEncounter = useCallback(async (): Promise<void> => {
    if (encounterPendingRef.current) {
      return
    }

    if (activePatientTab === null) {
      setWorkspaceMessage({ tone: 'ALERT', text: 'Select a patient before starting screening.' })
      return
    }

    if (selectedSession === null) {
      setWorkspaceMessage({ tone: 'ALERT', text: 'Select an open session before starting.' })
      return
    }

    const requestId = startRequestRef.current + 1
    encounterPendingRef.current = true
    startRequestRef.current = requestId
    setEncounterPending(true)
    setMessage(null)

    try {
      const result = await api.screeningEncounters.start({
        patientId: activePatientTab.patient.id,
        screeningSessionId: selectedSession.id
      })

      if (!mountedRef.current || startRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        const text =
          result.error.code === 'IPC_FORBIDDEN'
            ? 'This window cannot start screening encounters.'
            : 'Screening start is unavailable. Try again.'
        setWorkspaceMessage({ tone: 'ALERT', text })
        return
      }

      const nextMessage = getEncounterStartMessage(result.data.status)
      setWorkspaceMessage(nextMessage)

      if (result.data.status === 'AUTHENTICATION_REQUIRED') {
        onScreeningAuthenticationFailure('AUTH_UNAUTHENTICATED')
        return
      }

      if (result.data.status === 'SESSION_NOT_FOUND' || result.data.status === 'SESSION_CLOSED') {
        void loadContext({ preserveMessage: true })
      }

      if (result.data.status === 'STARTED' || result.data.status === 'ALREADY_EXISTS') {
        const encounter = result.data.encounter

        setPatientTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.patient.id === activePatientTab.patient.id
              ? { ...tab, activeStep: 'VITALS', encounter }
              : tab
          )
        )
      }
    } catch {
      if (mountedRef.current && startRequestRef.current === requestId) {
        setWorkspaceMessage({ tone: 'ALERT', text: 'Screening start is unavailable. Try again.' })
      }
    } finally {
      if (mountedRef.current && startRequestRef.current === requestId) {
        encounterPendingRef.current = false
        setEncounterPending(false)
      }
    }
  }, [
    activePatientTab,
    api,
    loadContext,
    mountedRef,
    onScreeningAuthenticationFailure,
    selectedSession,
    setWorkspaceMessage
  ])

  const selectedSessionText =
    selectedSession === null
      ? 'No current open session selected'
      : `${selectedLocation?.name ?? 'Selected location'} | ${selectedSession.sessionDate}`

  const patientWorkspace =
    activePatientTab === null ? (
      <div className="screening-empty-state" role="status">
        Select a patient to open the screening workspace.
      </div>
    ) : (
      <>
        <section className="screening-active-header" aria-label="Active screening context">
          <div>
            <strong>{activePatientTab.patient.displayName}</strong>
            <span>{selectedSessionText}</span>
          </div>
          <div>
            <span className="screening-status-badge screening-status-badge-open">
              <span
                className="screening-status-dot screening-status-dot-success"
                aria-hidden="true"
              />
              {activePatientTab.encounter === null ? 'Ready to start' : 'Encounter draft open'}
            </span>
            <button
              type="button"
              className="button button-primary"
              disabled={encounterPending || selectedSession === null}
              onClick={() => void startEncounter()}
            >
              {activePatientTab.encounter === null ? 'Begin screening' : 'Resume screening'}
            </button>
          </div>
        </section>

        <div className="screening-clinical-layout">
          <PatientContextPanel patient={activePatientTab.patient} />
          <section className="screening-encounter-panel" aria-label="Current screening encounter">
            <div className="screening-card-header">
              <div>
                <h2>Current screening encounter</h2>
                <p>
                  {activePatientTab.encounter === null
                    ? 'Start an encounter to collect data.'
                    : 'Draft encounter workspace.'}
                </p>
              </div>
              <span>{activeStepLabel}</span>
            </div>
            <ScreeningStepNavigation
              activeStep={activePatientTab.activeStep}
              onStepChange={updateActivePatientStep}
            />
            <ScreeningStepPanel activeStep={activePatientTab.activeStep} />
            <ClinicalActionPanel />
          </section>
        </div>
      </>
    )

  return (
    <section className="screening-encounter-workspace" aria-labelledby={headingId}>
      <div className="screening-workspace-heading">
        <div>
          <p className="application-workspace-kicker">Screening</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            New Screening
          </h1>
          <p>Find a patient, choose today&apos;s open session, and begin screening.</p>
        </div>
        <span className="screening-offline-badge">
          <span className="screening-status-dot screening-status-dot-success" aria-hidden="true" />
          Offline ready
        </span>
      </div>

      {message !== null ? (
        <div
          ref={messageRef}
          className={`screening-message ${
            message.tone === 'ALERT' ? 'screening-message-alert' : ''
          }`}
          role={message.tone === 'ALERT' ? 'alert' : 'status'}
          tabIndex={-1}
        >
          {message.text}
        </div>
      ) : null}

      {patientTabs.length > 0 ? (
        <PatientTabList
          tabs={patientTabs}
          activePatientId={activePatientId}
          tabRefs={tabRefs}
          onActivate={setActivePatientId}
          onClose={closePatientTab}
        />
      ) : null}

      {activePatientTab !== null ? patientWorkspace : null}

      <section className="screening-start-bar" aria-label="Session and patient selection">
        <SessionSelectionPanel
          contextState={contextState}
          sessionState={effectiveSessionState}
          selectedLocationId={selectedLocationId}
          selectedSessionId={selectedSessionId}
          onLocationChange={setSelectedLocationId}
          onSessionChange={setSelectedSessionId}
          onRefresh={() => void loadContext()}
        />
        <PatientSearchPanel
          query={patientQuery}
          state={searchState}
          onQueryChange={setPatientQuery}
          onSearch={() => void searchPatients()}
          onOpenPatient={openPatientTab}
        />
      </section>

      {activePatientTab === null ? patientWorkspace : null}
    </section>
  )
}

function SessionSelectionPanel({
  contextState,
  sessionState,
  selectedLocationId,
  selectedSessionId,
  onLocationChange,
  onSessionChange,
  onRefresh
}: {
  readonly contextState: WorkspaceContextState
  readonly sessionState: SessionState
  readonly selectedLocationId: string | null
  readonly selectedSessionId: string | null
  onLocationChange(locationId: string | null): void
  onSessionChange(sessionId: string | null): void
  onRefresh(): void
}): React.JSX.Element {
  if (contextState.status === 'LOADING') {
    return (
      <section className="screening-context-card" aria-label="Current session">
        <h2>Current session</h2>
        <div className="screening-empty-state" role="status">
          Loading locations...
        </div>
      </section>
    )
  }

  if (contextState.status === 'ERROR') {
    return (
      <section className="screening-context-card" aria-label="Current session">
        <h2>Current session</h2>
        <div className="screening-message screening-message-alert" role="alert">
          {contextState.message}
        </div>
        <button type="button" className="button button-secondary" onClick={onRefresh}>
          Refresh
        </button>
      </section>
    )
  }

  return (
    <section className="screening-context-card" aria-label="Current session">
      <div className="screening-card-header">
        <div>
          <h2>Current session</h2>
          <p>{contextState.deploymentLocalDate}</p>
        </div>
        <button type="button" className="button button-secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <label className="screening-field">
        <span>Active screening location</span>
        <select
          value={selectedLocationId ?? ''}
          onChange={(event) => {
            onLocationChange(event.currentTarget.value || null)
            onSessionChange(null)
          }}
        >
          <option value="">Select a location</option>
          {contextState.activeLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label className="screening-field">
        <span>Open session</span>
        <select
          value={selectedSessionId ?? ''}
          disabled={sessionState.status !== 'READY'}
          onChange={(event) => onSessionChange(event.currentTarget.value || null)}
        >
          <option value="">Select an open session</option>
          {sessionState.status === 'READY'
            ? sessionState.items.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.sessionDate}
                </option>
              ))
            : null}
        </select>
      </label>
      <SessionStateMessage state={sessionState} selectedLocationId={selectedLocationId} />
    </section>
  )
}

function SessionStateMessage({
  state,
  selectedLocationId
}: {
  readonly state: SessionState
  readonly selectedLocationId: string | null
}): React.JSX.Element | null {
  if (selectedLocationId === null) {
    return (
      <p className="screening-state-note" role="status">
        Select a location.
      </p>
    )
  }

  if (state.status === 'LOADING') {
    return (
      <p className="screening-state-note" role="status">
        Loading open sessions...
      </p>
    )
  }

  if (state.status === 'EMPTY') {
    return (
      <p className="screening-state-note" role="status">
        No open session for this location today.
      </p>
    )
  }

  if (state.status === 'ERROR') {
    return (
      <p className="screening-restricted-note" role="alert">
        {state.message}
      </p>
    )
  }

  return null
}

function PatientSearchPanel({
  query,
  state,
  onQueryChange,
  onSearch,
  onOpenPatient
}: {
  readonly query: string
  readonly state: SearchState
  onQueryChange(query: string): void
  onSearch(): void
  onOpenPatient(patient: PublicPatientSummary): void
}): React.JSX.Element {
  return (
    <section className="screening-session-card" aria-label="Patient search">
      <div className="screening-card-header">
        <div>
          <h2>Find patient</h2>
          <p>Open an existing patient before screening.</p>
        </div>
      </div>
      <form
        className="screening-patient-search-form"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch()
        }}
      >
        <label className="screening-field">
          <span>Patient search</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Name, phone, village, or patient code"
          />
        </label>
        <button
          type="submit"
          className="button button-primary"
          disabled={state.status === 'LOADING'}
        >
          Search
        </button>
      </form>
      <PatientSearchResults state={state} onOpenPatient={onOpenPatient} />
    </section>
  )
}

function PatientSearchResults({
  state,
  onOpenPatient
}: {
  readonly state: SearchState
  onOpenPatient(patient: PublicPatientSummary): void
}): React.JSX.Element | null {
  if (state.status === 'IDLE') {
    return null
  }

  if (state.status === 'LOADING') {
    return (
      <div className="screening-empty-state" role="status">
        Searching patients...
      </div>
    )
  }

  if (state.status === 'EMPTY') {
    return (
      <div className="screening-empty-state" role="status">
        No matching patients found.
      </div>
    )
  }

  if (state.status === 'ERROR') {
    return (
      <div className="screening-message screening-message-alert" role="alert">
        {state.message}
      </div>
    )
  }

  return (
    <div className="screening-patient-results">
      {state.items.map((patient) => (
        <div key={patient.id} className="screening-patient-result">
          <div>
            <strong>{patient.displayName}</strong>
            <span>{formatPatientDemographicSummary(patient)}</span>
          </div>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onOpenPatient(patient)}
          >
            Open patient
          </button>
        </div>
      ))}
    </div>
  )
}

function PatientTabList({
  tabs,
  activePatientId,
  tabRefs,
  onActivate,
  onClose
}: {
  readonly tabs: readonly PatientWorkspaceTab[]
  readonly activePatientId: string | null
  readonly tabRefs: MutableRefObject<Map<string, HTMLButtonElement>>
  onActivate(patientId: string): void
  onClose(patientId: string): void
}): React.JSX.Element {
  return (
    <div className="screening-patient-tabs" role="tablist" aria-label="Open screening patients">
      {tabs.map((tab, index) => {
        const isActive = tab.patient.id === activePatientId
        const tabId = `screening-patient-tab-${tab.patient.id}`

        return (
          <div key={tab.patient.id} className="screening-patient-tab-shell">
            <button
              ref={(element) => {
                if (element === null) {
                  tabRefs.current.delete(tab.patient.id)
                } else {
                  tabRefs.current.set(tab.patient.id, element)
                }
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className="screening-patient-tab"
              onClick={() => onActivate(tab.patient.id)}
              onKeyDown={(event) =>
                handlePatientTabKeyDown(event, index, tabs, onActivate, tabRefs)
              }
            >
              <span className="screening-patient-tab-label">{getPatientTabLabel(tab.patient)}</span>
            </button>
            <button
              type="button"
              className="screening-patient-tab-close"
              aria-label={`Close ${getPatientTabLabel(tab.patient)}`}
              onClick={() => onClose(tab.patient.id)}
            >
              x
            </button>
          </div>
        )
      })}
    </div>
  )
}

function handlePatientTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
  tabs: readonly PatientWorkspaceTab[],
  onActivate: (patientId: string) => void,
  tabRefs: MutableRefObject<Map<string, HTMLButtonElement>>
): void {
  let nextIndex: number | null = null

  switch (event.key) {
    case 'ArrowRight':
      nextIndex = (index + 1) % tabs.length
      break
    case 'ArrowLeft':
      nextIndex = (index - 1 + tabs.length) % tabs.length
      break
    case 'Home':
      nextIndex = 0
      break
    case 'End':
      nextIndex = tabs.length - 1
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      onActivate(tabs[index]!.patient.id)
      return
    default:
      return
  }

  event.preventDefault()
  const nextPatientId = tabs[nextIndex]?.patient.id

  if (nextPatientId !== undefined) {
    onActivate(nextPatientId)
    queueMicrotask(() => tabRefs.current.get(nextPatientId)?.focus({ preventScroll: true }))
  }
}

function PatientContextPanel({
  patient
}: {
  readonly patient: PublicPatientSummary
}): React.JSX.Element {
  return (
    <aside className="screening-patient-context-panel" aria-label="Patient context">
      <div className="screening-card-header">
        <div>
          <h2>Patient context</h2>
          <p>Read-only screening context.</p>
        </div>
        <span className="screening-referral-badge">
          <span aria-hidden="true">!</span>
          No referral data
        </span>
      </div>
      <div className="screening-patient-identity">
        <div className="screening-patient-avatar" aria-hidden="true">
          {getInitials(patient.displayName)}
        </div>
        <div>
          <strong>{patient.displayName}</strong>
          <span>{formatPatientDemographicSummary(patient)}</span>
          <span>{formatPatientContact(patient)}</span>
        </div>
      </div>
      <ContextRegion title="Last three screening encounters" />
      <div className="screening-context-summary-grid">
        <ContextMetric title="30-day average BP" value="No recorded data" />
        <ContextMetric title="Recent pulse" value="No recorded data" />
        <ContextMetric title="OTC medication use" value="No recorded data" />
        <ContextMetric title="Screening count" value="No recorded data" />
      </div>
      <EmptyGraph title="Blood pressure trend" variant="bar" />
      <EmptyGraph title="Weight trend" variant="line" />
      <ContextRegion title="Follow-up date" />
    </aside>
  )
}

function ContextRegion({ title }: { readonly title: string }): React.JSX.Element {
  return (
    <section className="screening-context-region">
      <h3>{title}</h3>
      <p>No recorded data</p>
    </section>
  )
}

function ContextMetric({
  title,
  value
}: {
  readonly title: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div className="screening-context-metric">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  )
}

function EmptyGraph({
  title,
  variant
}: {
  readonly title: string
  readonly variant: 'bar' | 'line'
}): React.JSX.Element {
  return (
    <section className="screening-empty-graph" aria-label={title}>
      <h3>{title}</h3>
      <div className={`screening-empty-graph-plot screening-empty-graph-${variant}`}>
        <span className="screening-empty-graph-axis screening-empty-graph-axis-left" />
        <span className="screening-empty-graph-axis screening-empty-graph-axis-bottom" />
        <span className="screening-empty-graph-label">No recorded data</span>
      </div>
    </section>
  )
}

function ScreeningStepNavigation({
  activeStep,
  onStepChange
}: {
  readonly activeStep: ScreeningStepId
  onStepChange(stepId: ScreeningStepId): void
}): React.JSX.Element {
  return (
    <div className="screening-stepper" role="tablist" aria-label="Screening steps">
      {screeningSteps.map((step, index) => {
        const isActive = step.id === activeStep

        return (
          <button
            key={step.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`screening-step-panel-${step.id}`}
            className="screening-stepper-item"
            onClick={() => onStepChange(step.id)}
          >
            <span aria-hidden="true">{index + 1}</span>
            {step.label}
          </button>
        )
      })}
    </div>
  )
}

function ScreeningStepPanel({
  activeStep
}: {
  readonly activeStep: ScreeningStepId
}): React.JSX.Element {
  switch (activeStep) {
    case 'VITALS':
      return <VitalsStep />
    case 'LIFESTYLE':
      return (
        <UnavailableStep
          id="screening-step-panel-LIFESTYLE"
          title="Lifestyle"
          items={['Tobacco exposure', 'Alcohol use', 'Physical activity', 'Sleep and stress']}
        />
      )
    case 'FOOD':
      return (
        <UnavailableStep
          id="screening-step-panel-FOOD"
          title="Food"
          items={['Food catalog search', 'Recent foods', 'Frequency', 'Preparation notes']}
        />
      )
    case 'OTC':
      return (
        <UnavailableStep
          id="screening-step-panel-OTC"
          title="OTC Medications"
          items={['Product name', 'Reason taken', 'Dose and frequency', 'Medication source']}
        />
      )
    case 'REVIEW':
      return (
        <UnavailableStep
          id="screening-step-panel-REVIEW"
          title="Review"
          items={['Raw readings', 'Missing fields', 'Protocol version', 'Patient instructions']}
        />
      )
  }
}

function VitalsStep(): React.JSX.Element {
  return (
    <section
      id="screening-step-panel-VITALS"
      role="tabpanel"
      className="screening-step-panel"
      aria-label="Vitals"
    >
      <h3>Blood pressure readings</h3>
      <div className="screening-table-scroll">
        <table className="screening-worklist-table screening-vitals-table">
          <thead>
            <tr>
              <th scope="col">Reading</th>
              <th scope="col">Systolic</th>
              <th scope="col">Diastolic</th>
              <th scope="col">Pulse</th>
              <th scope="col">Arm</th>
              <th scope="col">Position</th>
              <th scope="col">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={7}>Available after the clinical data contract is enabled.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Additional current measurements</h3>
      <div className="screening-disabled-field-grid" aria-label="Unavailable current measurements">
        <DisabledField label="Weight (kg)" />
        <DisabledField label="Waist" />
        <DisabledField label="Notes" />
      </div>
    </section>
  )
}

function UnavailableStep({
  id,
  title,
  items
}: {
  readonly id: string
  readonly title: string
  readonly items: readonly string[]
}): React.JSX.Element {
  return (
    <section id={id} role="tabpanel" className="screening-step-panel" aria-label={title}>
      <h3>{title}</h3>
      <div className="screening-unavailable-grid">
        {items.map((item) => (
          <DisabledField key={item} label={item} />
        ))}
      </div>
      <div className="screening-empty-state" role="status">
        Available after the clinical data contract is enabled.
      </div>
    </section>
  )
}

function DisabledField({ label }: { readonly label: string }): React.JSX.Element {
  return (
    <div className="screening-disabled-field" aria-disabled="true">
      <span>{label}</span>
      <strong>Not available</strong>
    </div>
  )
}

function ClinicalActionPanel(): React.JSX.Element {
  return (
    <section className="screening-clinical-action-panel" aria-label="Screening action">
      <div>
        <span className="screening-action-icon" aria-hidden="true">
          i
        </span>
      </div>
      <div>
        <h3>Awaiting completed screening data</h3>
        <p>
          No protocol result is available yet. Required action will appear after approved clinical
          data is recorded.
        </p>
        <strong>Screening action, not a diagnosis.</strong>
      </div>
    </section>
  )
}

function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  return mountedRef
}
