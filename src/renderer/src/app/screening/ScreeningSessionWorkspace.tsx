import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction
} from 'react'

import type {
  HealthScreeningApi,
  LocalUserRole,
  PatientErrorCode,
  PatientSex,
  PublicCurrentScreeningSession,
  PublicPatientSummary,
  PublicScreeningEncounterStartSummary,
  PublicScreeningSessionWorkspaceLocation,
  ScreeningEncounterIpcErrorCode,
  ScreeningEncounterStartSuccessData,
  ScreeningSessionEnsureCurrentSuccessData,
  ScreeningSessionErrorCode
} from '@shared/ipc'

import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import {
  screeningPatientSearchPageSize,
  screeningPatientTabLimit,
  type ScreeningSessionWorkspaceCommandId
} from './screening-session-workspace-model'

interface ScreeningSessionWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly commandId: ScreeningSessionWorkspaceCommandId
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly openTabs: readonly PatientScreeningTab[]
  readonly activePatientId: string | null
  readonly userRole: LocalUserRole
  onActivePatientIdChange: Dispatch<SetStateAction<string | null>>
  onOpenTabsChange: Dispatch<SetStateAction<readonly PatientScreeningTab[]>>
  onScreeningSessionAuthenticationFailure(code: ScreeningSessionErrorCode): void
  onSelectCommand(commandId: 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'): void
  registerNavigationGuard(guard: WorkspaceNavigationGuard | null): void
}

type CurrentSessionState =
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly session: PublicCurrentScreeningSession
      readonly location: PublicScreeningSessionWorkspaceLocation
      readonly created: boolean
    }
  | {
      readonly status: 'BLOCKED'
      readonly message: string
      readonly retryable: boolean
    }

type PatientSearchState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly items: readonly PublicPatientSummary[]
      readonly page: number
      readonly pageSize: 25
      readonly total: number
    }
  | { readonly status: 'EMPTY'; readonly page: number; readonly pageSize: 25 }
  | { readonly status: 'ERROR'; readonly message: string }

export interface PatientScreeningTab {
  readonly patient: PublicPatientSummary
  readonly encounter: PublicScreeningEncounterStartSummary
}

type WorkspaceMessage = {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
}

type ScreeningWorkspaceTab = 'PATIENTS' | 'NEW_SCREENING'

const initialSessionState: CurrentSessionState = Object.freeze({ status: 'LOADING' })
const initialPatientSearchState: PatientSearchState = Object.freeze({ status: 'IDLE' })
const screeningSectionLabels = Object.freeze([
  'Vitals',
  'Lifestyle',
  'Food',
  'OTC',
  'Review'
] as const)

export function ScreeningSessionWorkspace({
  api,
  activePatientId,
  commandId,
  headingId,
  headingRef,
  openTabs,
  onActivePatientIdChange,
  onOpenTabsChange,
  onScreeningSessionAuthenticationFailure,
  onSelectCommand,
  registerNavigationGuard
}: ScreeningSessionWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const sessionRequestRef = useRef(0)
  const patientSearchRequestRef = useRef(0)
  const workspaceEpochRef = useRef(0)
  const pendingPatientIdsRef = useRef<Set<string>>(new Set())
  const messageRef = useRef<HTMLDivElement | null>(null)
  const [sessionState, setSessionState] = useState<CurrentSessionState>(initialSessionState)
  const [patientSearchState, setPatientSearchState] =
    useState<PatientSearchState>(initialPatientSearchState)
  const [patientSearchQuery, setPatientSearchQuery] = useState('')
  const [patientSearchPage, setPatientSearchPage] = useState(1)
  const [pendingPatientIds, setPendingPatientIds] = useState<ReadonlySet<string>>(() => new Set())
  const [message, setMessage] = useState<WorkspaceMessage | null>(null)

  const focusMessage = useCallback((): void => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        messageRef.current?.focus({ preventScroll: true })
      }
    })
  }, [mountedRef])

  const setWorkspaceMessage = useCallback(
    (text: string, tone: WorkspaceMessage['tone'] = 'STATUS'): void => {
      setMessage({ text, tone })
      focusMessage()
    },
    [focusMessage]
  )

  const clearTransientWorkflowState = useCallback((): void => {
    workspaceEpochRef.current += 1
    patientSearchRequestRef.current += 1
    pendingPatientIdsRef.current.clear()
    setPatientSearchState(initialPatientSearchState)
    setPendingPatientIds(new Set())
  }, [])

  const selectWorkspaceTab = useCallback(
    (tab: ScreeningWorkspaceTab): void => {
      onSelectCommand(tab === 'PATIENTS' ? 'SCREENING_TODAYS_SESSION' : 'SCREENING_NEW_SCREENING')
    },
    [onSelectCommand]
  )

  const loadCurrentSession = useCallback(async (): Promise<void> => {
    const requestId = sessionRequestRef.current + 1
    sessionRequestRef.current = requestId
    clearTransientWorkflowState()
    setSessionState(initialSessionState)
    setMessage(null)

    try {
      const result = await api.screeningSessions.ensureCurrent()

      if (!mountedRef.current || sessionRequestRef.current !== requestId) {
        return
      }

      if (!result.ok) {
        const message = getScreeningSessionTransportFailureMessage(result.error.code)
        setSessionState({ status: 'BLOCKED', message, retryable: true })

        if (isProtectedScreeningSessionFailure(result.error.code)) {
          onScreeningSessionAuthenticationFailure(result.error.code)
        }

        return
      }

      const data = result.data

      if (data.status === 'RESOLVED' || data.status === 'CREATED') {
        workspaceEpochRef.current += 1
        const readySessionId = data.session.id
        onOpenTabsChange((currentTabs) => {
          const currentSessionTabs = currentTabs.filter(
            (tab) => tab.encounter.screeningSessionId === readySessionId
          )

          onActivePatientIdChange((currentActivePatientId) => {
            if (
              currentActivePatientId !== null &&
              currentSessionTabs.some((tab) => tab.patient.id === currentActivePatientId)
            ) {
              return currentActivePatientId
            }

            return currentSessionTabs[0]?.patient.id ?? null
          })

          return currentSessionTabs
        })
        setSessionState({
          status: 'READY',
          session: data.session,
          location: data.location,
          created: data.status === 'CREATED'
        })
        setPatientSearchPage(1)
        return
      }

      const blocked = getEnsureCurrentBlockedState(data)
      setSessionState(blocked)
    } catch {
      if (!mountedRef.current || sessionRequestRef.current !== requestId) {
        return
      }

      setSessionState({
        status: 'BLOCKED',
        message: 'Session unavailable',
        retryable: true
      })
    }
  }, [
    api,
    clearTransientWorkflowState,
    mountedRef,
    onActivePatientIdChange,
    onOpenTabsChange,
    onScreeningSessionAuthenticationFailure
  ])

  const loadPatients = useCallback(
    async (query: string, page: number, sessionId: string, epoch: number): Promise<void> => {
      const requestId = patientSearchRequestRef.current + 1
      patientSearchRequestRef.current = requestId
      setPatientSearchState({ status: 'LOADING' })

      try {
        const result = await api.patient.search({
          query,
          page,
          pageSize: screeningPatientSearchPageSize
        })

        if (
          !mountedRef.current ||
          patientSearchRequestRef.current !== requestId ||
          workspaceEpochRef.current !== epoch ||
          sessionState.status !== 'READY' ||
          sessionState.session.id !== sessionId
        ) {
          return
        }

        if (!result.ok) {
          setPatientSearchState({
            status: 'ERROR',
            message: getPatientSearchFailureMessage(result.error.code)
          })
          return
        }

        if (result.data.items.length === 0) {
          setPatientSearchState({
            status: 'EMPTY',
            page: result.data.page,
            pageSize: screeningPatientSearchPageSize
          })
          return
        }

        setPatientSearchState({
          status: 'READY',
          items: result.data.items,
          page: result.data.page,
          pageSize: screeningPatientSearchPageSize,
          total: result.data.total
        })
      } catch {
        if (!mountedRef.current || patientSearchRequestRef.current !== requestId) {
          return
        }

        setPatientSearchState({ status: 'ERROR', message: 'Patient search unavailable.' })
      }
    },
    [api, mountedRef, sessionState]
  )

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        void loadCurrentSession()
      }
    })
  }, [loadCurrentSession, mountedRef])

  useEffect(() => {
    const guard: WorkspaceNavigationGuard = () => true
    registerNavigationGuard(guard)

    return () => {
      registerNavigationGuard(null)
    }
  }, [registerNavigationGuard])

  useEffect(() => {
    const pendingPatientIds = pendingPatientIdsRef.current

    return () => {
      workspaceEpochRef.current += 1
      patientSearchRequestRef.current += 1
      pendingPatientIds.clear()
    }
  }, [])

  useEffect(() => {
    if (sessionState.status !== 'READY') {
      return
    }

    void loadPatients(
      patientSearchQuery.trim(),
      patientSearchPage,
      sessionState.session.id,
      workspaceEpochRef.current
    )
  }, [loadPatients, patientSearchPage, patientSearchQuery, sessionState])

  const activatePatient = useCallback(
    async (patient: PublicPatientSummary): Promise<void> => {
      if (sessionState.status !== 'READY') {
        return
      }

      const existingTab = openTabs.find((tab) => tab.patient.id === patient.id)

      if (existingTab !== undefined) {
        onActivePatientIdChange(existingTab.patient.id)
        setMessage(null)
        selectWorkspaceTab('NEW_SCREENING')
        return
      }

      if (pendingPatientIdsRef.current.has(patient.id)) {
        return
      }

      const pendingNewCount = Array.from(pendingPatientIdsRef.current).filter((patientId) =>
        openTabs.every((tab) => tab.patient.id !== patientId)
      ).length

      if (openTabs.length + pendingNewCount >= screeningPatientTabLimit) {
        setWorkspaceMessage('Close one patient to continue', 'ALERT')
        return
      }

      const epoch = workspaceEpochRef.current
      const sessionId = sessionState.session.id
      pendingPatientIdsRef.current.add(patient.id)
      setPendingPatientIds(new Set(pendingPatientIdsRef.current))
      setMessage(null)

      try {
        const result = await api.screeningEncounters.start({
          patientId: patient.id,
          screeningSessionId: sessionId
        })

        if (
          !mountedRef.current ||
          workspaceEpochRef.current !== epoch ||
          sessionState.status !== 'READY' ||
          sessionState.session.id !== sessionId
        ) {
          return
        }

        if (!result.ok) {
          setWorkspaceMessage(getEncounterTransportFailureMessage(result.error.code), 'ALERT')
          return
        }

        if (result.data.status === 'STARTED' || result.data.status === 'ALREADY_EXISTS') {
          const encounter = result.data.encounter

          onOpenTabsChange((currentTabs) => {
            const currentExistingTab = currentTabs.find((tab) => tab.patient.id === patient.id)

            if (currentExistingTab !== undefined) {
              return currentTabs
            }

            if (currentTabs.length >= screeningPatientTabLimit) {
              setWorkspaceMessage('Close one patient to continue', 'ALERT')
              return currentTabs
            }

            return [...currentTabs, { patient, encounter }]
          })
          onActivePatientIdChange(patient.id)
          selectWorkspaceTab('NEW_SCREENING')
          return
        }

        setWorkspaceMessage(getEncounterStartStatusMessage(result.data), 'ALERT')
      } catch {
        if (mountedRef.current && workspaceEpochRef.current === epoch) {
          setWorkspaceMessage('Session unavailable', 'ALERT')
        }
      } finally {
        pendingPatientIdsRef.current.delete(patient.id)

        if (mountedRef.current) {
          setPendingPatientIds(new Set(pendingPatientIdsRef.current))
        }
      }
    },
    [
      api,
      mountedRef,
      onActivePatientIdChange,
      onOpenTabsChange,
      openTabs,
      selectWorkspaceTab,
      sessionState,
      setWorkspaceMessage
    ]
  )

  const closePatientTab = useCallback(
    (patientId: string): void => {
      onOpenTabsChange((currentTabs) => {
        const nextTabs = currentTabs.filter((tab) => tab.patient.id !== patientId)

        onActivePatientIdChange((currentActivePatientId) => {
          if (currentActivePatientId !== patientId) {
            return currentActivePatientId
          }

          const closedIndex = currentTabs.findIndex((tab) => tab.patient.id === patientId)
          const nextTab = nextTabs[Math.min(closedIndex, Math.max(nextTabs.length - 1, 0))]

          return nextTab?.patient.id ?? null
        })

        return nextTabs
      })
      setMessage(null)
    },
    [onActivePatientIdChange, onOpenTabsChange]
  )

  const retrySession = useCallback((): void => {
    void loadCurrentSession()
  }, [loadCurrentSession])

  const activeWorkspaceTab = getWorkspaceTabForCommand(commandId)
  const activeTab =
    openTabs.find((tab) => tab.patient.id === activePatientId) ?? openTabs[0] ?? null
  const hasReadySession = sessionState.status === 'READY'
  const workspaceHeading = activeWorkspaceTab === 'PATIENTS' ? 'Patients' : 'New Screening'

  return (
    <section className="screening-workspace" aria-labelledby={headingId}>
      <div className="screening-workspace-heading">
        <div>
          <h1 id={headingId} ref={headingRef}>
            {workspaceHeading}
          </h1>
        </div>
        {sessionState.status === 'READY' ? (
          <span className="screening-status-badge screening-status-badge-open">
            <span
              className="screening-status-dot screening-status-dot-success"
              aria-hidden="true"
            />
            Ready
          </span>
        ) : null}
      </div>

      {message !== null ? (
        <div
          ref={messageRef}
          className={`screening-message${
            message.tone === 'ALERT' ? ' screening-message-alert' : ''
          }`}
          role={message.tone === 'ALERT' ? 'alert' : 'status'}
          tabIndex={-1}
        >
          {message.text}
        </div>
      ) : null}

      {sessionState.status === 'LOADING' ? (
        <SessionGatePanel message="Resolving screening session..." />
      ) : sessionState.status === 'BLOCKED' ? (
        <SessionGatePanel message={sessionState.message} alert>
          {sessionState.retryable ? (
            <button className="button button-secondary" type="button" onClick={retrySession}>
              Retry
            </button>
          ) : null}
        </SessionGatePanel>
      ) : (
        <>
          {activeWorkspaceTab === 'PATIENTS' ? (
            <PatientsWorkspace
              activePatientId={activePatientId}
              hasReadySession={hasReadySession}
              patientSearchQuery={patientSearchQuery}
              pendingPatientIds={pendingPatientIds}
              searchState={patientSearchState}
              sessionDate={sessionState.session.sessionDate}
              onActivatePatient={activatePatient}
              onNextPage={() => setPatientSearchPage((page) => page + 1)}
              onPreviousPage={() => setPatientSearchPage((page) => Math.max(1, page - 1))}
              onSearchQueryChange={(query) => {
                setPatientSearchQuery(query)
                setPatientSearchPage(1)
              }}
            />
          ) : (
            <NewScreeningWorkspace
              activeTab={activeTab}
              location={sessionState.location}
              openTabs={openTabs}
              session={sessionState.session}
              onActivateTab={onActivePatientIdChange}
              onCloseTab={closePatientTab}
              onOpenPatients={() => selectWorkspaceTab('PATIENTS')}
            />
          )}
        </>
      )}
    </section>
  )
}

function SessionGatePanel({
  message,
  alert = false,
  children
}: {
  readonly message: string
  readonly alert?: boolean
  readonly children?: ReactNode
}): React.JSX.Element {
  return (
    <section
      className="screening-empty-state"
      aria-live={alert ? undefined : 'polite'}
      role={alert ? 'alert' : undefined}
    >
      <p>{message}</p>
      {children}
    </section>
  )
}

function PatientsWorkspace({
  activePatientId,
  hasReadySession,
  patientSearchQuery,
  pendingPatientIds,
  searchState,
  sessionDate,
  onActivatePatient,
  onNextPage,
  onPreviousPage,
  onSearchQueryChange
}: {
  readonly activePatientId: string | null
  readonly hasReadySession: boolean
  readonly patientSearchQuery: string
  readonly pendingPatientIds: ReadonlySet<string>
  readonly searchState: PatientSearchState
  readonly sessionDate: string
  onActivatePatient(patient: PublicPatientSummary): Promise<void>
  onNextPage(): void
  onPreviousPage(): void
  onSearchQueryChange(query: string): void
}): React.JSX.Element {
  return (
    <div className="screening-patients-layout">
      <section className="screening-patient-list-card" aria-labelledby="screening-patients-title">
        <div className="screening-card-header">
          <div>
            <h2 id="screening-patients-title">Patients</h2>
          </div>
          <span className="screening-session-date">{sessionDate}</span>
        </div>

        <label className="screening-patient-search" htmlFor="screening-patient-search">
          <span>Search patients</span>
          <input
            id="screening-patient-search"
            type="search"
            value={patientSearchQuery}
            placeholder="Search patients..."
            disabled={!hasReadySession}
            onChange={(event) => {
              onSearchQueryChange(event.currentTarget.value)
            }}
          />
        </label>

        <PatientTable
          activePatientId={activePatientId}
          pendingPatientIds={pendingPatientIds}
          searchState={searchState}
          onActivatePatient={onActivatePatient}
        />

        <PatientSearchPager
          searchState={searchState}
          onPrevious={onPreviousPage}
          onNext={onNextPage}
        />
      </section>
    </div>
  )
}

function PatientTable({
  activePatientId,
  pendingPatientIds,
  searchState,
  onActivatePatient
}: {
  readonly activePatientId: string | null
  readonly pendingPatientIds: ReadonlySet<string>
  readonly searchState: PatientSearchState
  onActivatePatient(patient: PublicPatientSummary): Promise<void>
}): React.JSX.Element {
  if (searchState.status === 'IDLE' || searchState.status === 'LOADING') {
    return <div className="screening-empty-state">Loading patients.</div>
  }

  if (searchState.status === 'ERROR') {
    return <div className="screening-empty-state">{searchState.message}</div>
  }

  if (searchState.status === 'EMPTY') {
    return <div className="screening-empty-state">No patients found.</div>
  }

  return (
    <div className="screening-table-scroll">
      <table className="screening-patient-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Date of birth</th>
            <th scope="col">Patient ID</th>
            <th scope="col">Sex</th>
          </tr>
        </thead>
        <tbody>
          {searchState.items.map((patient) => {
            const isActive = activePatientId === patient.id
            const isPending = pendingPatientIds.has(patient.id)
            const displayName = formatPatientName(patient)

            return (
              <tr
                key={patient.id}
                className="screening-patient-row"
                tabIndex={0}
                aria-label={`New Screening for ${displayName}, Patient ID ${patient.patientCode}`}
                aria-selected={isActive}
                aria-busy={isPending}
                data-active={isActive ? 'true' : 'false'}
                data-pending={isPending ? 'true' : 'false'}
                onClick={() => {
                  if (!isPending) {
                    void onActivatePatient(patient)
                  }
                }}
                onKeyDown={(event) => {
                  if (isPending) {
                    return
                  }

                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void onActivatePatient(patient)
                  }
                }}
              >
                <td>
                  <strong className="screening-patient-name">{displayName}</strong>
                  {isPending ? <span className="screening-row-status">Starting...</span> : null}
                </td>
                <td>{formatPatientDateOfBirth(patient)}</td>
                <td>{patient.patientCode}</td>
                <td>{formatPatientSex(patient.sex)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PatientSearchPager({
  searchState,
  onPrevious,
  onNext
}: {
  readonly searchState: PatientSearchState
  onPrevious(): void
  onNext(): void
}): React.JSX.Element | null {
  if (searchState.status !== 'READY') {
    return null
  }

  const firstVisible = (searchState.page - 1) * searchState.pageSize + 1
  const lastVisible = Math.min(searchState.total, searchState.page * searchState.pageSize)
  const hasPrevious = searchState.page > 1
  const hasNext = searchState.page * searchState.pageSize < searchState.total

  return (
    <div className="screening-pagination" aria-label="Patient search pagination">
      <span>
        {firstVisible}-{lastVisible} of {searchState.total}
      </span>
      <div className="screening-pagination-actions">
        <button
          className="button button-secondary"
          type="button"
          onClick={onPrevious}
          disabled={!hasPrevious}
        >
          Previous
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={onNext}
          disabled={!hasNext}
        >
          Next
        </button>
      </div>
    </div>
  )
}

function NewScreeningWorkspace({
  activeTab,
  location,
  openTabs,
  session,
  onActivateTab,
  onCloseTab,
  onOpenPatients
}: {
  readonly activeTab: PatientScreeningTab | null
  readonly location: PublicScreeningSessionWorkspaceLocation
  readonly openTabs: readonly PatientScreeningTab[]
  readonly session: PublicCurrentScreeningSession
  onActivateTab(patientId: string): void
  onCloseTab(patientId: string): void
  onOpenPatients(): void
}): React.JSX.Element {
  return (
    <section className="screening-new-screening-workspace" aria-label="New Screening workspace">
      <OpenPatientTabStrip
        activeTab={activeTab}
        openTabs={openTabs}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onOpenPatients={onOpenPatients}
      />

      {openTabs.length === 0 || activeTab === null ? (
        <div className="screening-empty-state screening-new-screening-empty">
          <p>Select a patient from the Patients tab to begin screening.</p>
          <button className="button button-secondary" type="button" onClick={onOpenPatients}>
            Patients
          </button>
        </div>
      ) : (
        <div className="screening-split-workspace">
          <PatientContextPanel tab={activeTab} />
          <CurrentEncounterPanel location={location} session={session} tab={activeTab} />
        </div>
      )}
    </section>
  )
}

function OpenPatientTabStrip({
  activeTab,
  openTabs,
  onActivateTab,
  onCloseTab,
  onOpenPatients
}: {
  readonly activeTab: PatientScreeningTab | null
  readonly openTabs: readonly PatientScreeningTab[]
  onActivateTab(patientId: string): void
  onCloseTab(patientId: string): void
  onOpenPatients(): void
}): React.JSX.Element {
  return (
    <div className="screening-open-patient-strip">
      <div className="screening-patient-tabs" role="tablist" aria-label="Open patient screenings">
        {openTabs.map((tab) => {
          const isSelected = activeTab?.patient.id === tab.patient.id
          const displayName = formatPatientName(tab.patient)
          const tabLabel = formatPatientTabLabel(tab.patient)

          return (
            <div
              className="screening-patient-tab-shell"
              key={tab.patient.id}
              data-selected={isSelected ? 'true' : 'false'}
            >
              <button
                className="screening-patient-tab"
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onActivateTab(tab.patient.id)}
              >
                {tabLabel}
              </button>
              <button
                className="screening-patient-tab-close"
                type="button"
                aria-label={`Close ${displayName}`}
                onClick={() => onCloseTab(tab.patient.id)}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div className="screening-open-patient-controls">
        <button className="screening-open-patient-action" type="button" onClick={onOpenPatients}>
          Search / open patient
        </button>
        <span className="screening-tab-count">
          {openTabs.length}/{screeningPatientTabLimit}
        </span>
      </div>
    </div>
  )
}

function PatientContextPanel({ tab }: { readonly tab: PatientScreeningTab }): React.JSX.Element {
  const displayName = formatPatientName(tab.patient)
  const villageQuarter = formatVillageQuarter(tab.patient)

  return (
    <section className="screening-context-panel" aria-labelledby="screening-patient-context-title">
      <header className="screening-card-header">
        <div>
          <h2 id="screening-patient-context-title">Patient context</h2>
        </div>
      </header>

      <div className="screening-patient-context-identity">
        <span className="screening-patient-initials" aria-hidden="true">
          {formatPatientInitials(tab.patient)}
        </span>
        <div>
          <h3>{displayName}</h3>
          <p>
            Date of birth {formatPatientDateOfBirth(tab.patient)} •{' '}
            {formatPatientSex(tab.patient.sex)}
            {villageQuarter === null ? '' : ` • ${villageQuarter}`} • {tab.patient.patientCode}
          </p>
        </div>
      </div>

      <section className="screening-context-section" aria-labelledby="screening-history-title">
        <h3 id="screening-history-title">Last three screening readings</h3>
        <div className="screening-empty-state screening-compact-empty">
          Screening history unavailable.
        </div>
      </section>

      <div className="screening-context-metrics">
        <section aria-labelledby="screening-average-title">
          <h3 id="screening-average-title">30-day average BP</h3>
          <strong>—</strong>
        </section>
        <section aria-labelledby="screening-referral-title">
          <h3 id="screening-referral-title">Referral status</h3>
          <strong>—</strong>
          <span>Last contact: —</span>
        </section>
      </div>

      <section className="screening-context-section" aria-labelledby="screening-bp-trend-title">
        <h3 id="screening-bp-trend-title">Blood pressure trend</h3>
        <div className="screening-empty-state screening-compact-empty">Trend unavailable.</div>
      </section>

      <section className="screening-context-section" aria-labelledby="screening-weight-trend-title">
        <h3 id="screening-weight-trend-title">Weight trend</h3>
        <div className="screening-empty-state screening-compact-empty">Trend unavailable.</div>
      </section>
    </section>
  )
}

function CurrentEncounterPanel({
  location,
  session,
  tab
}: {
  readonly location: PublicScreeningSessionWorkspaceLocation
  readonly session: PublicCurrentScreeningSession
  readonly tab: PatientScreeningTab
}): React.JSX.Element {
  const displayName = formatPatientName(tab.patient)

  return (
    <section
      className="screening-current-encounter-panel"
      aria-label={`Current screening encounter for ${displayName}`}
    >
      <header className="screening-current-encounter-header">
        <h2>Current screening encounter</h2>
        <span>
          Session: {session.sessionDate} • {location.name}
        </span>
      </header>

      <ol className="screening-stepper" aria-label="Screening workflow steps">
        {screeningSectionLabels.map((label, index) => (
          <li key={label} data-active={index === 0 ? 'true' : 'false'}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      <section className="screening-current-step" aria-labelledby="screening-vitals-step-title">
        <div className="screening-current-step-header">
          <h3 id="screening-vitals-step-title">Vitals</h3>
          <span>{formatEncounterStatus(tab.encounter.status)}</span>
        </div>

        <div className="screening-vitals-placeholder" aria-label="Vitals data unavailable">
          <div>
            <span>Blood pressure readings</span>
            <strong>—</strong>
          </div>
          <div>
            <span>Additional current measurements</span>
            <strong>—</strong>
          </div>
        </div>

        <div className="screening-guidance-note" role="note">
          <strong>Screening guidance—not a diagnosis.</strong>
          <span>Current clinical fields unavailable.</span>
        </div>

        <div className="screening-encounter-actions">
          <button className="button button-secondary" type="button" disabled>
            Previous
          </button>
          <button className="button button-primary" type="button" disabled>
            Continue to lifestyle
          </button>
        </div>
      </section>
    </section>
  )
}

function getEnsureCurrentBlockedState(
  data: Exclude<
    ScreeningSessionEnsureCurrentSuccessData,
    { readonly status: 'RESOLVED' | 'CREATED' }
  >
): Extract<CurrentSessionState, { readonly status: 'BLOCKED' }> {
  switch (data.status) {
    case 'AUTHENTICATION_REQUIRED':
      return { status: 'BLOCKED', message: 'Sign in is required.', retryable: true }
    case 'FORBIDDEN':
      return {
        status: 'BLOCKED',
        message: 'The active session is not authorized for Screening.',
        retryable: false
      }
    case 'LOCATION_NOT_CONFIGURED':
      return {
        status: 'BLOCKED',
        message: 'Screening location is not configured.',
        retryable: false
      }
    case 'LOCATION_NOT_FOUND':
      return {
        status: 'BLOCKED',
        message: 'The configured screening location could not be found.',
        retryable: false
      }
    case 'LOCATION_INACTIVE':
      return {
        status: 'BLOCKED',
        message: 'The configured screening location is inactive.',
        retryable: false
      }
    case 'SESSION_CLOSED':
      return {
        status: 'BLOCKED',
        message: "Today's screening session is closed.",
        retryable: false
      }
    case 'SESSION_CONFLICT':
    case 'NO_ACTIVE_PROTOCOL':
    case 'UNAVAILABLE':
      return { status: 'BLOCKED', message: 'Session unavailable', retryable: true }
  }
}

function getScreeningSessionTransportFailureMessage(code: ScreeningSessionErrorCode): string {
  switch (code) {
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'The active session is not authorized for Screening.'
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to open Screening.'
    case 'VALIDATION_FAILED':
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Session unavailable'
  }
}

function isProtectedScreeningSessionFailure(code: ScreeningSessionErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}

function getWorkspaceTabForCommand(
  commandId: ScreeningSessionWorkspaceCommandId
): ScreeningWorkspaceTab {
  return commandId === 'SCREENING_NEW_SCREENING' ? 'NEW_SCREENING' : 'PATIENTS'
}

function getPatientSearchFailureMessage(code: PatientErrorCode): string {
  switch (code) {
    case 'AUTH_UNAUTHENTICATED':
      return 'Sign in is required.'
    case 'AUTH_LOCKED':
      return 'The local session is locked.'
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return 'A required password change must be completed first.'
    case 'AUTHORIZATION_FAILED':
      return 'The active session is not authorized for patient search.'
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to search patients.'
    case 'VALIDATION_FAILED':
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Patient search unavailable.'
  }
}

function getEncounterTransportFailureMessage(code: ScreeningEncounterIpcErrorCode): string {
  switch (code) {
    case 'IPC_FORBIDDEN':
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Session unavailable'
  }
}

function getEncounterStartStatusMessage(data: ScreeningEncounterStartSuccessData): string {
  switch (data.status) {
    case 'STARTED':
    case 'ALREADY_EXISTS':
      return 'New Screening'
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for Screening.'
    case 'PATIENT_NOT_FOUND':
      return 'Patient not found.'
    case 'PATIENT_INELIGIBLE':
      return 'Patient is not eligible for screening.'
    case 'SESSION_NOT_FOUND':
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_CURRENT':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
    case 'UNAVAILABLE':
      return 'Session unavailable'
    case 'VALIDATION_FAILED':
      return 'The patient screening could not be started.'
  }
}

function formatPatientName(patient: PublicPatientSummary): string {
  return (
    patient.displayName.trim() ||
    [patient.givenName, patient.familyName].join(' ').trim() ||
    'Unnamed patient'
  )
}

function formatPatientSex(sex: PatientSex): string {
  switch (sex) {
    case 'FEMALE':
      return 'Female'
    case 'MALE':
      return 'Male'
    case 'OTHER':
      return 'Other'
    case 'UNKNOWN':
      return 'Unknown'
  }
}

function formatPatientDateOfBirth(patient: PublicPatientSummary): string {
  return patient.dateOfBirth ?? '—'
}

function formatPatientTabLabel(patient: PublicPatientSummary): string {
  return `${formatPatientName(patient)} • ${patient.patientCode}`
}

function formatPatientInitials(patient: PublicPatientSummary): string {
  const sourceNames = [patient.givenName, patient.familyName].filter(
    (name): name is string => name !== null && name.trim().length > 0
  )

  if (sourceNames.length > 0) {
    return sourceNames
      .slice(0, 2)
      .map((name) => name.trim().charAt(0).toUpperCase())
      .join('')
  }

  const fallbackInitial = formatPatientName(patient).trim().charAt(0).toUpperCase()

  return fallbackInitial.length > 0 ? fallbackInitial : 'P'
}

function formatVillageQuarter(patient: PublicPatientSummary): string | null {
  const value = [patient.village, patient.quarter]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(' / ')

  return value.length > 0 ? value : null
}

function formatEncounterStatus(status: PublicScreeningEncounterStartSummary['status']): string {
  switch (status) {
    case 'DRAFT':
      return 'In progress'
    case 'COMPLETED':
      return 'Completed'
    case 'AMENDED':
      return 'Amended'
    case 'VOID':
      return 'Void'
  }
}

function useMountedRef(): MutableRefObject<boolean> {
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  return mountedRef
}
