import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject
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
  readonly userRole: LocalUserRole
  onScreeningSessionAuthenticationFailure(code: ScreeningSessionErrorCode): void
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

interface PatientScreeningTab {
  readonly patient: PublicPatientSummary
  readonly encounter: PublicScreeningEncounterStartSummary
}

type WorkspaceMessage = {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
}

const initialSessionState: CurrentSessionState = Object.freeze({ status: 'LOADING' })
const initialPatientSearchState: PatientSearchState = Object.freeze({ status: 'IDLE' })
const screeningSectionLabels = Object.freeze([
  'Vitals',
  'Lifestyle',
  'Food',
  'OTC Medications',
  'Review'
] as const)

export function ScreeningSessionWorkspace({
  api,
  headingId,
  headingRef,
  onScreeningSessionAuthenticationFailure,
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
  const [openTabs, setOpenTabs] = useState<readonly PatientScreeningTab[]>([])
  const [activePatientId, setActivePatientId] = useState<string | null>(null)
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

  const clearWorkflowState = useCallback((): void => {
    workspaceEpochRef.current += 1
    patientSearchRequestRef.current += 1
    pendingPatientIdsRef.current.clear()
    setPatientSearchState(initialPatientSearchState)
    setOpenTabs([])
    setActivePatientId(null)
    setPendingPatientIds(new Set())
  }, [])

  const loadCurrentSession = useCallback(async (): Promise<void> => {
    const requestId = sessionRequestRef.current + 1
    sessionRequestRef.current = requestId
    clearWorkflowState()
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
        setWorkspaceMessage(message, 'ALERT')

        if (isProtectedScreeningSessionFailure(result.error.code)) {
          onScreeningSessionAuthenticationFailure(result.error.code)
        }

        return
      }

      const data = result.data

      if (data.status === 'RESOLVED' || data.status === 'CREATED') {
        workspaceEpochRef.current += 1
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
      setWorkspaceMessage(blocked.message, 'ALERT')
    } catch {
      if (!mountedRef.current || sessionRequestRef.current !== requestId) {
        return
      }

      setSessionState({
        status: 'BLOCKED',
        message: 'Session unavailable',
        retryable: true
      })
      setWorkspaceMessage('Session unavailable', 'ALERT')
    }
  }, [
    api,
    clearWorkflowState,
    mountedRef,
    onScreeningSessionAuthenticationFailure,
    setWorkspaceMessage
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
        setActivePatientId(existingTab.patient.id)
        setMessage(null)
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

          setOpenTabs((currentTabs) => {
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
          setActivePatientId(patient.id)
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
    [api, mountedRef, openTabs, sessionState, setWorkspaceMessage]
  )

  const closePatientTab = useCallback((patientId: string): void => {
    setOpenTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => tab.patient.id !== patientId)

      setActivePatientId((currentActivePatientId) => {
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
  }, [])

  const retrySession = useCallback((): void => {
    void loadCurrentSession()
  }, [loadCurrentSession])

  const activeTab = openTabs.find((tab) => tab.patient.id === activePatientId) ?? null
  const hasReadySession = sessionState.status === 'READY'

  return (
    <section className="screening-workspace" aria-labelledby={headingId}>
      <div className="screening-workspace-heading">
        <div>
          <h1 id={headingId} ref={headingRef}>
            Patients
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
        <SessionGatePanel message={sessionState.message}>
          {sessionState.retryable ? (
            <button className="button button-secondary" type="button" onClick={retrySession}>
              Retry
            </button>
          ) : null}
        </SessionGatePanel>
      ) : (
        <div className="screening-patients-layout">
          <section
            className="screening-patient-list-card"
            aria-labelledby="screening-patients-title"
          >
            <div className="screening-card-header">
              <div>
                <h2 id="screening-patients-title">Patients</h2>
              </div>
              <span className="screening-session-date">{sessionState.session.sessionDate}</span>
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
                  setPatientSearchQuery(event.currentTarget.value)
                  setPatientSearchPage(1)
                }}
              />
            </label>

            <PatientTable
              activePatientId={activePatientId}
              operationalDate={sessionState.session.sessionDate}
              pendingPatientIds={pendingPatientIds}
              searchState={patientSearchState}
              onActivatePatient={activatePatient}
            />

            <PatientSearchPager
              searchState={patientSearchState}
              onPrevious={() => setPatientSearchPage((page) => Math.max(1, page - 1))}
              onNext={() => setPatientSearchPage((page) => page + 1)}
            />
          </section>

          <PatientTabs
            activeTab={activeTab}
            openTabs={openTabs}
            onActivateTab={setActivePatientId}
            onCloseTab={closePatientTab}
          />
        </div>
      )}
    </section>
  )
}

function SessionGatePanel({
  message,
  children
}: {
  readonly message: string
  readonly children?: ReactNode
}): React.JSX.Element {
  return (
    <section className="screening-empty-state" aria-live="polite">
      <p>{message}</p>
      {children}
    </section>
  )
}

function PatientTable({
  activePatientId,
  operationalDate,
  pendingPatientIds,
  searchState,
  onActivatePatient
}: {
  readonly activePatientId: string | null
  readonly operationalDate: string
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
            <th scope="col">Sex</th>
            <th scope="col">Age</th>
            <th scope="col">Last Screening</th>
            <th scope="col">Follow-up</th>
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
                aria-label={`New Screening for ${displayName}`}
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
                <td>{formatPatientSex(patient.sex)}</td>
                <td>{formatPatientAge(patient, operationalDate)}</td>
                <td aria-label="Screening history unavailable">—</td>
                <td aria-label="No follow-up status">—</td>
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

function PatientTabs({
  activeTab,
  openTabs,
  onActivateTab,
  onCloseTab
}: {
  readonly activeTab: PatientScreeningTab | null
  readonly openTabs: readonly PatientScreeningTab[]
  onActivateTab(patientId: string): void
  onCloseTab(patientId: string): void
}): React.JSX.Element {
  return (
    <section className="screening-encounter-card" aria-labelledby="screening-tabs-title">
      <div className="screening-card-header">
        <div>
          <h2 id="screening-tabs-title">New Screening</h2>
        </div>
        <span className="screening-tab-count">
          {openTabs.length}/{screeningPatientTabLimit}
        </span>
      </div>

      {openTabs.length === 0 ? (
        <div className="screening-empty-state">Choose a patient to begin.</div>
      ) : (
        <>
          <div
            className="screening-patient-tabs"
            role="tablist"
            aria-label="Open patient screenings"
          >
            {openTabs.map((tab) => {
              const isSelected = activeTab?.patient.id === tab.patient.id
              const displayName = formatPatientName(tab.patient)

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
                    {displayName}
                  </button>
                  <button
                    className="screening-patient-tab-close"
                    type="button"
                    aria-label={`Close ${displayName}`}
                    onClick={() => onCloseTab(tab.patient.id)}
                  >
                    x
                  </button>
                </div>
              )
            })}
          </div>

          {activeTab !== null ? <PatientScreeningPanel tab={activeTab} /> : null}
        </>
      )}
    </section>
  )
}

function PatientScreeningPanel({ tab }: { readonly tab: PatientScreeningTab }): React.JSX.Element {
  const displayName = formatPatientName(tab.patient)

  return (
    <section className="screening-patient-panel" aria-label={`New Screening for ${displayName}`}>
      <header className="screening-patient-panel-header">
        <div>
          <h3>{displayName}</h3>
          <span>{formatEncounterStatus(tab.encounter.status)}</span>
        </div>
        <span className="screening-disclaimer">Screening guidance—not a diagnosis.</span>
      </header>

      <div className="screening-clinical-tabs" role="tablist" aria-label="Screening sections">
        {screeningSectionLabels.map((label, index) => (
          <button
            key={label}
            className="screening-clinical-tab"
            type="button"
            role="tab"
            aria-selected={index === 0}
            tabIndex={index === 0 ? 0 : -1}
          >
            {label}
          </button>
        ))}
      </div>
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
        message: 'This installation does not have a configured screening location.',
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

function formatPatientAge(patient: PublicPatientSummary, operationalDate: string): string {
  if (patient.dateOfBirth !== null) {
    return formatAgeFromDateOfBirth(patient.dateOfBirth, operationalDate)
  }

  if (patient.approximateAgeYears !== null) {
    return patient.ageAsOfDate === null
      ? `${patient.approximateAgeYears}`
      : `${patient.approximateAgeYears} as of ${patient.ageAsOfDate}`
  }

  return 'Not recorded'
}

function formatAgeFromDateOfBirth(dateOfBirth: string, operationalDate: string): string {
  const birthYear = Number(dateOfBirth.slice(0, 4))
  const birthMonth = Number(dateOfBirth.slice(5, 7))
  const birthDay = Number(dateOfBirth.slice(8, 10))
  const operationalYear = Number(operationalDate.slice(0, 4))
  const operationalMonth = Number(operationalDate.slice(5, 7))
  const operationalDay = Number(operationalDate.slice(8, 10))

  if (
    !Number.isInteger(birthYear) ||
    !Number.isInteger(birthMonth) ||
    !Number.isInteger(birthDay) ||
    !Number.isInteger(operationalYear) ||
    !Number.isInteger(operationalMonth) ||
    !Number.isInteger(operationalDay)
  ) {
    return dateOfBirth
  }

  let age = operationalYear - birthYear

  if (
    operationalMonth < birthMonth ||
    (operationalMonth === birthMonth && operationalDay < birthDay)
  ) {
    age -= 1
  }

  return age >= 0 && age <= 120 ? `${age}` : dateOfBirth
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
