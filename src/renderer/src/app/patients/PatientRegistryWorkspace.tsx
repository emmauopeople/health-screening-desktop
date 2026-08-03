import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
  RefObject
} from 'react'

import type {
  HealthScreeningApi,
  PatientEditableFields,
  PatientErrorCode,
  PublicPatientDetail,
  PublicPatientDuplicateCandidate,
  PublicPatientDuplicatePair,
  PublicPatientSummary
} from '@shared/ipc'

import type {
  ApplicationCommandId,
  PatientWorkspaceNavigationGuard
} from '../shell/application-shell-types'

type PatientCommandId =
  | 'PATIENTS_PATIENT_SEARCH'
  | 'PATIENTS_REGISTER_NEW_PATIENT'
  | 'PATIENTS_RECENT_PATIENTS'
  | 'PATIENTS_POSSIBLE_DUPLICATES'

interface PatientRegistryWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly commandId: PatientCommandId
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly selectedPatient: PublicPatientDetail | null
  onSelectedPatientChange(patient: PublicPatientDetail | null): void
  onPatientAuthenticationFailure(code: PatientErrorCode): void
  onSelectCommand(commandId: ApplicationCommandId): void
  registerNavigationGuard(guard: PatientWorkspaceNavigationGuard | null): void
}

type LoadState = 'IDLE' | 'LOADING' | 'READY' | 'EMPTY' | 'ERROR'
type PatientStateInvalidator = () => void
type RegisterPatientStateInvalidator = (invalidator: PatientStateInvalidator) => () => void
type RegistrationValidationField = 'name' | 'dateOfBirth' | 'approximateAgeYears' | 'ageAsOfDate'
type RegistrationValidationErrors = Partial<Record<RegistrationValidationField, string>>
type RegistrationFocusField = 'givenName' | 'dateOfBirth' | 'approximateAgeYears' | 'ageAsOfDate'

const transportFailureMessage = 'The desktop service is unavailable.'
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u

const emptyEditableFields: PatientEditableFields = Object.freeze({
  givenName: null,
  familyName: null,
  otherNames: null,
  dateOfBirth: null,
  approximateAgeYears: null,
  ageAsOfDate: null,
  sex: 'UNKNOWN',
  village: null,
  quarter: null,
  phone: null,
  alternateContactName: null,
  alternateContactPhone: null,
  residenceNotes: null,
  status: 'ACTIVE',
  acknowledgmentStatus: 'NOT_REQUESTED'
})

export function PatientRegistryWorkspace({
  api,
  commandId,
  headingId,
  headingRef,
  selectedPatient,
  onSelectedPatientChange,
  onPatientAuthenticationFailure,
  onSelectCommand,
  registerNavigationGuard
}: PatientRegistryWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const securityEpochRef = useRef(0)
  const patientStateInvalidatorsRef = useRef(new Set<PatientStateInvalidator>())
  const [editMode, setEditMode] = useState(false)
  const [draft, setDraft] = useState<PatientEditableFields>(emptyEditableFields)
  const [editDirty, setEditDirty] = useState(false)
  const [conflictPatient, setConflictPatient] = useState<PublicPatientDetail | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showDirtyGuard, setShowDirtyGuard] = useState(false)
  const pendingDirtyAction = useRef<(() => void) | null>(null)
  const pendingDirtyActionNeedsNavigationBypassRef = useRef(false)
  const allowResolvedDirtyNavigationRef = useRef(false)
  const patientLoadRequestRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const invalidateProtectedPatientState = useCallback((): void => {
    securityEpochRef.current += 1
  }, [])

  const registerPatientStateInvalidator = useCallback(
    (invalidator: PatientStateInvalidator): (() => void) => {
      patientStateInvalidatorsRef.current.add(invalidator)

      return () => {
        patientStateInvalidatorsRef.current.delete(invalidator)
      }
    },
    []
  )

  const clearProtectedPatientState = useCallback((): void => {
    invalidateProtectedPatientState()
    for (const invalidatePatientState of Array.from(patientStateInvalidatorsRef.current)) {
      invalidatePatientState()
    }
    onSelectedPatientChange(null)
    setDraft(emptyEditableFields)
    setEditMode(false)
    setEditDirty(false)
    setConflictPatient(null)
    setSaving(false)
    pendingDirtyAction.current = null
    pendingDirtyActionNeedsNavigationBypassRef.current = false
    allowResolvedDirtyNavigationRef.current = false
    setShowDirtyGuard(false)
  }, [invalidateProtectedPatientState, onSelectedPatientChange])

  const handlePatientFailure = useCallback(
    (code: PatientErrorCode, fallbackMessage: string): boolean => {
      if (
        code === 'IPC_FORBIDDEN' ||
        code === 'AUTH_LOCKED' ||
        code === 'AUTH_UNAUTHENTICATED' ||
        code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
        code === 'AUTHORIZATION_FAILED'
      ) {
        clearProtectedPatientState()
        setMessage(fallbackMessage)
        onPatientAuthenticationFailure(code)
        return true
      }

      setMessage(fallbackMessage)
      return false
    },
    [clearProtectedPatientState, onPatientAuthenticationFailure]
  )

  const beginDirtyGuard = useCallback(
    (action: () => void): boolean => {
      if (!editDirty) {
        action()
        return true
      }

      pendingDirtyAction.current = action
      pendingDirtyActionNeedsNavigationBypassRef.current = false
      setShowDirtyGuard(true)
      return false
    },
    [editDirty]
  )

  useEffect(() => {
    const guard: PatientWorkspaceNavigationGuard = (nextCommandId) => {
      if (allowResolvedDirtyNavigationRef.current) {
        allowResolvedDirtyNavigationRef.current = false
        return true
      }

      if (isPatientCommand(nextCommandId) && nextCommandId === commandId) {
        return true
      }

      if (!editDirty) {
        return true
      }

      pendingDirtyAction.current = () => onSelectCommand(nextCommandId)
      pendingDirtyActionNeedsNavigationBypassRef.current = true
      setShowDirtyGuard(true)
      return false
    }

    registerNavigationGuard(guard)

    return () => {
      registerNavigationGuard(null)
    }
  }, [commandId, editDirty, onSelectCommand, registerNavigationGuard])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
        return
      }

      event.preventDefault()
      onSelectCommand('PATIENTS_PATIENT_SEARCH')
      window.setTimeout(() => searchInputRef.current?.focus({ preventScroll: true }), 0)
    }

    window.addEventListener('keydown', listener)

    return () => window.removeEventListener('keydown', listener)
  }, [onSelectCommand])

  const isCurrentOperation = useCallback(
    (startedSecurityEpoch: number): boolean =>
      mountedRef.current && securityEpochRef.current === startedSecurityEpoch,
    [mountedRef]
  )

  const loadAndSelectPatient = useCallback(
    async (patientId: string): Promise<boolean> => {
      const requestId = patientLoadRequestRef.current + 1
      patientLoadRequestRef.current = requestId
      const startedSecurityEpoch = securityEpochRef.current
      setMessage('Loading patient.')

      try {
        const result = await api.patient.get({ patientId })

        if (
          !isCurrentOperation(startedSecurityEpoch) ||
          patientLoadRequestRef.current !== requestId
        ) {
          return false
        }

        if (!result.ok) {
          handlePatientFailure(result.error.code, result.error.message)
          return false
        }

        onSelectedPatientChange(result.data)
        setDraft(detailToEditable(result.data))
        setEditMode(false)
        setEditDirty(false)
        setConflictPatient(null)
        setMessage(null)
        return true
      } catch {
        if (
          isCurrentOperation(startedSecurityEpoch) &&
          patientLoadRequestRef.current === requestId
        ) {
          setMessage(transportFailureMessage)
        }

        return false
      }
    },
    [api, handlePatientFailure, isCurrentOperation, onSelectedPatientChange]
  )

  const selectPatient = useCallback(
    (patientId: string): void => {
      beginDirtyGuard(() => {
        void loadAndSelectPatient(patientId)
      })
    },
    [beginDirtyGuard, loadAndSelectPatient]
  )

  const saveDraft = useCallback(async (): Promise<boolean> => {
    if (selectedPatient === null || saving) {
      return false
    }

    const startedSecurityEpoch = securityEpochRef.current
    setSaving(true)
    setMessage(null)

    try {
      const result = await api.patient.update({
        patientId: selectedPatient.id,
        expectedRowVersion: selectedPatient.rowVersion,
        patch: draft
      })

      if (!isCurrentOperation(startedSecurityEpoch)) {
        return false
      }

      if (!result.ok) {
        handlePatientFailure(result.error.code, result.error.message)
        return false
      }

      if (result.data.status === 'PATIENT_VERSION_CONFLICT') {
        setConflictPatient(result.data.patient)
        setEditMode(true)
        setEditDirty(true)
        setMessage('The patient changed after you opened it. Review the latest details.')
        return false
      }

      onSelectedPatientChange(result.data.patient)
      setDraft(detailToEditable(result.data.patient))
      setEditDirty(false)
      setConflictPatient(null)
      setEditMode(false)
      setMessage('Changes saved.')
      return true
    } catch {
      if (isCurrentOperation(startedSecurityEpoch)) {
        setMessage(transportFailureMessage)
      }

      return false
    } finally {
      if (isCurrentOperation(startedSecurityEpoch)) {
        setSaving(false)
      }
    }
  }, [
    api,
    draft,
    handlePatientFailure,
    isCurrentOperation,
    onSelectedPatientChange,
    saving,
    selectedPatient
  ])

  const discardDraft = useCallback((): void => {
    if (selectedPatient !== null) {
      setDraft(detailToEditable(selectedPatient))
    }

    setEditDirty(false)
    setConflictPatient(null)
    setEditMode(false)
    setMessage(null)
  }, [selectedPatient])

  const completePendingDirtyAction = useCallback((): void => {
    const action = pendingDirtyAction.current
    const needsNavigationBypass = pendingDirtyActionNeedsNavigationBypassRef.current
    pendingDirtyAction.current = null
    pendingDirtyActionNeedsNavigationBypassRef.current = false
    setShowDirtyGuard(false)

    if (needsNavigationBypass) {
      allowResolvedDirtyNavigationRef.current = true
    }

    action?.()
    allowResolvedDirtyNavigationRef.current = false
  }, [])

  const heading = useMemo(() => {
    switch (commandId) {
      case 'PATIENTS_REGISTER_NEW_PATIENT':
        return 'Register New Patient'
      case 'PATIENTS_RECENT_PATIENTS':
        return 'Recent Patients'
      case 'PATIENTS_POSSIBLE_DUPLICATES':
        return 'Possible Duplicates'
      case 'PATIENTS_PATIENT_SEARCH':
        return 'Patient Search and Management'
    }
  }, [commandId])

  return (
    <>
      <header className="application-workspace-heading patient-workspace-heading">
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {heading}
        </h1>
      </header>

      {message !== null ? (
        <div className="patient-alert" role="status">
          {message}
        </div>
      ) : null}

      {commandId === 'PATIENTS_REGISTER_NEW_PATIENT' ? (
        <PatientRegistrationWorkspace
          api={api}
          securityEpochRef={securityEpochRef}
          registerStateInvalidator={registerPatientStateInvalidator}
          onPatientFailure={handlePatientFailure}
          onPatientCreated={(patient) => {
            onSelectedPatientChange(patient)
            setDraft(detailToEditable(patient))
            setEditMode(false)
            setEditDirty(false)
            setConflictPatient(null)
            setMessage('Patient created.')
            onSelectCommand('PATIENTS_PATIENT_SEARCH')
          }}
          onOpenPatient={(patientId) => {
            onSelectCommand('PATIENTS_PATIENT_SEARCH')
            void loadAndSelectPatient(patientId)
          }}
          onMessage={setMessage}
          onCancel={() => onSelectCommand('PATIENTS_PATIENT_SEARCH')}
        />
      ) : (
        <div className="patient-management-layout">
          <section className="patient-list-pane" aria-label={heading}>
            {commandId === 'PATIENTS_PATIENT_SEARCH' ? (
              <PatientSearchPane
                api={api}
                securityEpochRef={securityEpochRef}
                registerStateInvalidator={registerPatientStateInvalidator}
                selectedPatientId={selectedPatient?.id ?? null}
                searchInputRef={searchInputRef}
                onPatientFailure={handlePatientFailure}
                onSelectPatient={selectPatient}
                onRegister={() => onSelectCommand('PATIENTS_REGISTER_NEW_PATIENT')}
              />
            ) : null}
            {commandId === 'PATIENTS_RECENT_PATIENTS' ? (
              <RecentPatientsPane
                api={api}
                securityEpochRef={securityEpochRef}
                registerStateInvalidator={registerPatientStateInvalidator}
                selectedPatientId={selectedPatient?.id ?? null}
                onPatientFailure={handlePatientFailure}
                onSelectPatient={selectPatient}
              />
            ) : null}
            {commandId === 'PATIENTS_POSSIBLE_DUPLICATES' ? (
              <PossibleDuplicatesPane
                api={api}
                securityEpochRef={securityEpochRef}
                registerStateInvalidator={registerPatientStateInvalidator}
                onPatientFailure={handlePatientFailure}
                onSelectPatient={selectPatient}
                onMessage={setMessage}
              />
            ) : null}
          </section>

          <PatientDetailPane
            patient={selectedPatient}
            draft={draft}
            editMode={editMode}
            dirty={editDirty}
            saving={saving}
            conflictPatient={conflictPatient}
            onDraftChange={(nextDraft) => {
              setDraft(nextDraft)
              setEditDirty(true)
            }}
            onEdit={() => {
              if (selectedPatient !== null) {
                setDraft(detailToEditable(selectedPatient))
                setEditMode(true)
                setEditDirty(false)
                setConflictPatient(null)
              }
            }}
            onSave={() => {
              void saveDraft()
            }}
            onCancel={() => {
              beginDirtyGuard(discardDraft)
            }}
            onReload={() => {
              if (selectedPatient !== null) {
                void loadAndSelectPatient(selectedPatient.id)
              }
            }}
            onReloadLatest={() => {
              if (conflictPatient !== null) {
                onSelectedPatientChange(conflictPatient)
                setDraft(detailToEditable(conflictPatient))
                setEditMode(false)
                setEditDirty(false)
                setConflictPatient(null)
                setMessage('Loaded the latest patient details.')
              }
            }}
            onDiscardMyEdits={() => {
              if (conflictPatient !== null) {
                onSelectedPatientChange(conflictPatient)
                setDraft(detailToEditable(conflictPatient))
                setEditMode(false)
                setEditDirty(false)
                setConflictPatient(null)
                setMessage('Discarded your edits.')
              }
            }}
            onContinueEditing={() => {
              setConflictPatient(null)
              setEditMode(true)
              setEditDirty(true)
              setMessage('Continue editing your unsaved changes.')
            }}
          />
        </div>
      )}

      {showDirtyGuard ? (
        <PatientModalDialog
          title="Unsaved patient changes"
          pending={saving}
          onCancel={() => {
            pendingDirtyAction.current = null
            pendingDirtyActionNeedsNavigationBypassRef.current = false
            allowResolvedDirtyNavigationRef.current = false
            setShowDirtyGuard(false)
          }}
        >
          <p className="patient-dialog-copy">Save or discard your edits before leaving.</p>
          <div className="patient-dialog-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={() => {
                void saveDraft().then((saved) => {
                  if (saved) {
                    completePendingDirtyAction()
                  }
                })
              }}
            >
              Save changes
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={() => {
                discardDraft()
                completePendingDirtyAction()
              }}
            >
              Discard edits
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={() => {
                pendingDirtyAction.current = null
                pendingDirtyActionNeedsNavigationBypassRef.current = false
                allowResolvedDirtyNavigationRef.current = false
                setShowDirtyGuard(false)
              }}
            >
              Cancel
            </button>
          </div>
        </PatientModalDialog>
      ) : null}
    </>
  )
}

function PatientSearchPane({
  api,
  securityEpochRef,
  registerStateInvalidator,
  selectedPatientId,
  searchInputRef,
  onPatientFailure,
  onSelectPatient,
  onRegister
}: {
  readonly api: HealthScreeningApi
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  readonly selectedPatientId: string | null
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectPatient(patientId: string): void
  onRegister(): void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<readonly PublicPatientSummary[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<LoadState>('IDLE')
  const [failureMessage, setFailureMessage] = useState<string | null>(null)

  const invalidateLocalState = useCallback((): void => {
    requestRef.current += 1
    setQuery('')
    setPage(1)
    setItems([])
    setTotal(0)
    setState('IDLE')
    setFailureMessage(null)
  }, [])

  useEffect(
    () => registerStateInvalidator(invalidateLocalState),
    [invalidateLocalState, registerStateInvalidator]
  )

  const runSearch = useCallback(
    async (nextPage: number): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      const startedSecurityEpoch = securityEpochRef.current
      setState('LOADING')
      setFailureMessage(null)

      try {
        const result = await api.patient.search({
          query,
          page: nextPage,
          pageSize
        })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          requestRef.current !== requestId
        ) {
          return
        }

        if (!result.ok) {
          onPatientFailure(result.error.code, result.error.message)
          setItems([])
          setTotal(0)
          setState('ERROR')
          setFailureMessage(result.error.message)
          return
        }

        setItems(result.data.items)
        setTotal(result.data.total)
        setPage(result.data.page)
        setState(result.data.items.length === 0 ? 'EMPTY' : 'READY')
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          requestRef.current === requestId
        ) {
          setItems([])
          setTotal(0)
          setState('ERROR')
          setFailureMessage(transportFailureMessage)
        }
      }
    },
    [api, mountedRef, onPatientFailure, pageSize, query, securityEpochRef]
  )

  const emptyText = getPatientSearchEmptyText(state, failureMessage)

  return (
    <>
      <div className="patient-search-toolbar">
        <label className="patient-search-label" htmlFor="patient-registry-search">
          Patient search
        </label>
        <input
          id="patient-registry-search"
          ref={searchInputRef}
          type="search"
          value={query}
          placeholder="Code, name, phone, DOB, age, sex, village, quarter"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void runSearch(1)
            }
          }}
        />
        <button
          type="button"
          className="button button-primary"
          disabled={state === 'LOADING'}
          onClick={() => void runSearch(1)}
        >
          Search
        </button>
        <button type="button" className="button button-secondary" onClick={onRegister}>
          Register New
        </button>
        <select
          value={pageSize}
          aria-label="Page size"
          disabled={state === 'LOADING'}
          onChange={(event) => {
            const value = Number(event.target.value)
            setPageSize(value === 50 || value === 100 ? value : 25)
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <PatientSummaryTable
        items={items}
        selectedPatientId={selectedPatientId}
        emptyText={emptyText}
        onSelectPatient={onSelectPatient}
      />
      <div className="patient-pagination">
        <span>
          Page {page} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <button
          type="button"
          className="button button-secondary"
          disabled={state === 'LOADING' || page <= 1}
          onClick={() => void runSearch(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={state === 'LOADING' || page * pageSize >= total}
          onClick={() => void runSearch(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  )
}

function RecentPatientsPane({
  api,
  securityEpochRef,
  registerStateInvalidator,
  selectedPatientId,
  onPatientFailure,
  onSelectPatient
}: {
  readonly api: HealthScreeningApi
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  readonly selectedPatientId: string | null
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectPatient(patientId: string): void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  const [items, setItems] = useState<readonly PublicPatientSummary[]>([])
  const [state, setState] = useState<LoadState>('IDLE')
  const [failureMessage, setFailureMessage] = useState<string | null>(null)

  const invalidateLocalState = useCallback((): void => {
    requestRef.current += 1
    setItems([])
    setState('IDLE')
    setFailureMessage(null)
  }, [])

  useEffect(
    () => registerStateInvalidator(invalidateLocalState),
    [invalidateLocalState, registerStateInvalidator]
  )

  const loadRecent = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    const startedSecurityEpoch = securityEpochRef.current
    setState('LOADING')
    setFailureMessage(null)

    try {
      const result = await api.patient.listRecent({ limit: 25 })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        requestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        onPatientFailure(result.error.code, result.error.message)
        setItems([])
        setState('ERROR')
        setFailureMessage(result.error.message)
        return
      }

      setItems(result.data)
      setState(result.data.length === 0 ? 'EMPTY' : 'READY')
    } catch {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        requestRef.current === requestId
      ) {
        setItems([])
        setState('ERROR')
        setFailureMessage(transportFailureMessage)
      }
    }
  }, [api, mountedRef, onPatientFailure, securityEpochRef])

  useEffect(() => {
    let active = true

    const run = async (): Promise<void> => {
      await Promise.resolve()

      if (active) {
        await loadRecent()
      }
    }

    void run()

    return () => {
      active = false
    }
  }, [loadRecent])

  return (
    <PatientSummaryTable
      items={items}
      selectedPatientId={selectedPatientId}
      emptyText={getRecentEmptyText(state, failureMessage)}
      onSelectPatient={onSelectPatient}
    />
  )
}

function PossibleDuplicatesPane({
  api,
  securityEpochRef,
  registerStateInvalidator,
  onPatientFailure,
  onSelectPatient,
  onMessage
}: {
  readonly api: HealthScreeningApi
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectPatient(patientId: string): void
  onMessage(message: string | null): void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const loadRequestRef = useRef(0)
  const reviewPendingRef = useRef(false)
  const [pairs, setPairs] = useState<readonly PublicPatientDuplicatePair[]>([])
  const [selectedPair, setSelectedPair] = useState<PublicPatientDuplicatePair | null>(null)
  const [state, setState] = useState<LoadState>('IDLE')
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const [reviewPending, setReviewPending] = useState(false)

  const invalidateLocalState = useCallback((): void => {
    loadRequestRef.current += 1
    reviewPendingRef.current = false
    setPairs([])
    setSelectedPair(null)
    setState('IDLE')
    setFailureMessage(null)
    setReviewPending(false)
  }, [])

  useEffect(
    () => registerStateInvalidator(invalidateLocalState),
    [invalidateLocalState, registerStateInvalidator]
  )

  const loadPairs = useCallback(async (): Promise<void> => {
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    const startedSecurityEpoch = securityEpochRef.current
    setState('LOADING')
    setFailureMessage(null)

    try {
      const result = await api.patient.findDuplicates({
        identity: null,
        patientId: null,
        limit: 25
      })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        loadRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        onPatientFailure(result.error.code, result.error.message)
        setPairs([])
        setSelectedPair(null)
        setState('ERROR')
        setFailureMessage(result.error.message)
        return
      }

      setPairs(result.data.pairs)
      setSelectedPair(result.data.pairs[0] ?? null)
      setState(result.data.pairs.length === 0 ? 'EMPTY' : 'READY')
    } catch {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        loadRequestRef.current === requestId
      ) {
        setPairs([])
        setSelectedPair(null)
        setState('ERROR')
        setFailureMessage(transportFailureMessage)
      }
    }
  }, [api, mountedRef, onPatientFailure, securityEpochRef])

  useEffect(() => {
    let active = true

    const run = async (): Promise<void> => {
      await Promise.resolve()

      if (active) {
        await loadPairs()
      }
    }

    void run()

    return () => {
      active = false
    }
  }, [loadPairs])

  const markNotDuplicate = async (pair: PublicPatientDuplicatePair): Promise<void> => {
    if (reviewPendingRef.current) {
      return
    }

    const startedSecurityEpoch = securityEpochRef.current
    reviewPendingRef.current = true
    setReviewPending(true)
    onMessage(null)

    try {
      const result = await api.patient.markNotDuplicate({
        patientIdA: pair.first.id,
        patientIdB: pair.second.id,
        reasonCodes: ['MANUAL_REVIEW']
      })

      if (!mountedRef.current || securityEpochRef.current !== startedSecurityEpoch) {
        return
      }

      if (!result.ok) {
        onPatientFailure(result.error.code, result.error.message)
        return
      }

      onMessage('Duplicate review saved.')
      await loadPairs()
    } catch {
      if (mountedRef.current && securityEpochRef.current === startedSecurityEpoch) {
        onMessage(transportFailureMessage)
      }
    } finally {
      if (mountedRef.current && securityEpochRef.current === startedSecurityEpoch) {
        reviewPendingRef.current = false
        setReviewPending(false)
      }
    }
  }

  return (
    <div className="patient-duplicates-layout">
      <div className="patient-duplicate-pairs">
        {pairs.length === 0 ? (
          <p className="patient-empty">{getDuplicatePairsEmptyText(state, failureMessage)}</p>
        ) : null}
        {pairs.map((pair) => (
          <button
            key={pair.pairKey}
            type="button"
            className="patient-duplicate-pair"
            aria-pressed={selectedPair?.pairKey === pair.pairKey}
            onClick={() => setSelectedPair(pair)}
          >
            <span>{pair.first.patientCode}</span>
            <span>{pair.second.patientCode}</span>
            <strong>{pair.score}</strong>
            <span className="patient-match-reasons">{formatMatchReasons(pair.matchedOn)}</span>
          </button>
        ))}
      </div>
      <div className="patient-duplicate-comparison">
        {selectedPair === null ? (
          <p className="patient-empty">Select a duplicate pair.</p>
        ) : (
          <>
            <DuplicatePatientCard patient={selectedPair.first} matchedOn={selectedPair.matchedOn} />
            <DuplicatePatientCard
              patient={selectedPair.second}
              matchedOn={selectedPair.matchedOn}
            />
            <div className="patient-detail-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={reviewPending}
                onClick={() => onSelectPatient(selectedPair.first.id)}
              >
                View first
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={reviewPending}
                onClick={() => onSelectPatient(selectedPair.second.id)}
              >
                View second
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={reviewPending}
                onClick={() => void markNotDuplicate(selectedPair)}
              >
                Mark not duplicate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PatientRegistrationWorkspace({
  api,
  securityEpochRef,
  registerStateInvalidator,
  onPatientCreated,
  onOpenPatient,
  onPatientFailure,
  onMessage,
  onCancel
}: {
  readonly api: HealthScreeningApi
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  onPatientCreated(patient: PublicPatientDetail): void
  onOpenPatient(patientId: string): void
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onMessage(message: string | null): void
  onCancel(): void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const createRequestRef = useRef(0)
  const duplicateRequestRef = useRef(0)
  const duplicateCheckPendingRef = useRef(false)
  const createPendingRef = useRef(false)
  const [draft, setDraft] = useState<PatientEditableFields>(emptyEditableFields)
  const [candidates, setCandidates] = useState<readonly PublicPatientDuplicateCandidate[]>([])
  const [duplicateReviewToken, setDuplicateReviewToken] = useState<string | null>(null)
  const [confirmContinue, setConfirmContinue] = useState(false)
  const [duplicateCheckPending, setDuplicateCheckPending] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [validationErrors, setValidationErrors] = useState<RegistrationValidationErrors>({})
  const givenNameRef = useRef<HTMLInputElement | null>(null)
  const dateOfBirthRef = useRef<HTMLInputElement | null>(null)
  const approximateAgeRef = useRef<HTMLInputElement | null>(null)
  const ageAsOfDateRef = useRef<HTMLInputElement | null>(null)

  const anyPending = duplicateCheckPending || createPending

  const invalidateLocalState = useCallback((): void => {
    duplicateRequestRef.current += 1
    createRequestRef.current += 1
    duplicateCheckPendingRef.current = false
    createPendingRef.current = false
    setDraft(emptyEditableFields)
    setCandidates([])
    setDuplicateReviewToken(null)
    setConfirmContinue(false)
    setDuplicateCheckPending(false)
    setCreatePending(false)
    setValidationErrors({})
  }, [])

  useEffect(
    () => registerStateInvalidator(invalidateLocalState),
    [invalidateLocalState, registerStateInvalidator]
  )

  const updateDraft = (nextDraft: PatientEditableFields): void => {
    setDraft(nextDraft)
    setValidationErrors({})
    setCandidates([])
    setDuplicateReviewToken(null)
    setConfirmContinue(false)
    onMessage(null)
  }

  const focusRegistrationField = (field: RegistrationFocusField): void => {
    const refs: Record<RegistrationFocusField, MutableRefObject<HTMLInputElement | null>> = {
      givenName: givenNameRef,
      dateOfBirth: dateOfBirthRef,
      approximateAgeYears: approximateAgeRef,
      ageAsOfDate: ageAsOfDateRef
    }
    const control = refs[field].current

    if (control !== null && !control.disabled) {
      control.focus({ preventScroll: true })
    }
  }

  const getValidatedRegistrationDraft = (): PatientEditableFields | null => {
    const submitDraft = normalizeAgeEntryForSubmit(draft)
    const validation = validateRegistrationDraft(submitDraft)

    setValidationErrors(validation.errors)

    if (validation.focusField !== null) {
      focusRegistrationField(validation.focusField)
      onMessage('Complete required patient fields before continuing.')
      return null
    }

    return submitDraft
  }

  const checkDuplicates = async (): Promise<void> => {
    if (duplicateCheckPendingRef.current || createPendingRef.current) {
      return
    }

    const submitDraft = getValidatedRegistrationDraft()

    if (submitDraft === null) {
      return
    }

    const requestId = duplicateRequestRef.current + 1
    duplicateRequestRef.current = requestId
    const startedSecurityEpoch = securityEpochRef.current
    duplicateCheckPendingRef.current = true
    setDuplicateCheckPending(true)
    onMessage(null)

    try {
      const result = await api.patient.findDuplicates({
        identity: submitDraft,
        patientId: null,
        limit: 10
      })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        duplicateRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        onPatientFailure(result.error.code, result.error.message)
        return
      }

      setCandidates(result.data.candidates)
      setDuplicateReviewToken(null)
      onMessage(result.data.candidates.length === 0 ? 'No likely duplicates found.' : null)
    } catch {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        duplicateRequestRef.current === requestId
      ) {
        onMessage(transportFailureMessage)
      }
    } finally {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        duplicateRequestRef.current === requestId
      ) {
        duplicateCheckPendingRef.current = false
        setDuplicateCheckPending(false)
      }
    }
  }

  const createPatient = async (duplicateToken: string | null): Promise<void> => {
    if (createPendingRef.current) {
      return
    }

    const submitDraft = getValidatedRegistrationDraft()

    if (submitDraft === null) {
      return
    }

    const requestId = createRequestRef.current + 1
    createRequestRef.current = requestId
    const startedSecurityEpoch = securityEpochRef.current
    createPendingRef.current = true
    setCreatePending(true)
    onMessage(null)

    try {
      const result = await api.patient.create({
        ...submitDraft,
        duplicateReviewToken: duplicateToken
      })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        createRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        onPatientFailure(result.error.code, result.error.message)
        return
      }

      if (result.data.status === 'DUPLICATE_REVIEW_REQUIRED') {
        setCandidates(result.data.candidates)
        setDuplicateReviewToken(result.data.duplicateReviewToken)
        setConfirmContinue(false)
        onMessage('Review possible duplicates before creating this patient.')
        return
      }

      onPatientCreated(result.data.patient)
    } catch {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        createRequestRef.current === requestId
      ) {
        onMessage(transportFailureMessage)
      }
    } finally {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        createRequestRef.current === requestId
      ) {
        createPendingRef.current = false
        setCreatePending(false)
      }
    }
  }

  const hasDuplicateCandidates = candidates.length > 0

  return (
    <section
      className={
        hasDuplicateCandidates
          ? 'patient-registration patient-registration-review-layout'
          : 'patient-registration patient-registration-centered'
      }
    >
      <div className="patient-registration-form-panel">
        <PatientFieldsForm
          draft={draft}
          disabled={anyPending}
          mode="registration"
          validationErrors={validationErrors}
          inputRefs={{
            givenName: givenNameRef,
            dateOfBirth: dateOfBirthRef,
            approximateAgeYears: approximateAgeRef,
            ageAsOfDate: ageAsOfDateRef
          }}
          onDraftChange={updateDraft}
        />
        <div className="patient-detail-actions patient-registration-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={anyPending}
            onClick={() => void checkDuplicates()}
          >
            Check duplicates
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={anyPending || duplicateReviewToken !== null}
            onClick={() => void createPatient(null)}
          >
            Create patient
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={anyPending}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>

      {hasDuplicateCandidates ? (
        <aside
          className="patient-duplicate-review"
          aria-labelledby="patient-duplicate-review-heading"
        >
          <h2 id="patient-duplicate-review-heading">Possible Duplicate Patients</h2>
          <p className="patient-duplicate-review-copy">
            Review the fixed match reasons before continuing registration.
          </p>
          {candidates.map((candidate) => (
            <DuplicatePatientCard
              key={candidate.patient.id}
              patient={candidate.patient}
              matchedOn={candidate.matchedOn}
            >
              <button
                type="button"
                className="button button-secondary"
                disabled={anyPending}
                onClick={() => onOpenPatient(candidate.patient.id)}
              >
                Open existing patient
              </button>
            </DuplicatePatientCard>
          ))}
          <div className="patient-detail-actions patient-duplicate-review-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={anyPending}
              onClick={() => {
                setCandidates([])
                setDuplicateReviewToken(null)
                setConfirmContinue(false)
                onMessage(null)
              }}
            >
              Return to edit
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={anyPending || duplicateReviewToken === null}
              onClick={() => setConfirmContinue(true)}
            >
              Continue registration despite possible matches
            </button>
          </div>
        </aside>
      ) : null}

      {confirmContinue && duplicateReviewToken !== null ? (
        <PatientModalDialog
          title="Continue registration despite possible matches"
          pending={createPending}
          onCancel={() => setConfirmContinue(false)}
        >
          <p className="patient-dialog-copy">
            This will create a new patient even though possible matches were found.
          </p>
          <div className="patient-dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={createPending}
              onClick={() => setConfirmContinue(false)}
            >
              Return to edit
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={createPending}
              onClick={() => void createPatient(duplicateReviewToken)}
            >
              Continue registration despite possible matches
            </button>
          </div>
        </PatientModalDialog>
      ) : null}
    </section>
  )
}

function PatientSummaryTable({
  items,
  selectedPatientId,
  emptyText,
  onSelectPatient
}: {
  readonly items: readonly PublicPatientSummary[]
  readonly selectedPatientId: string | null
  readonly emptyText: string
  onSelectPatient(patientId: string): void
}): React.JSX.Element {
  return (
    <div className="patient-table-scroll">
      <table className="patient-table">
        <thead>
          <tr>
            <th scope="col">Patient code</th>
            <th scope="col">Name</th>
            <th scope="col">Age / DOB</th>
            <th scope="col">Sex</th>
            <th scope="col">Village / quarter</th>
            <th scope="col">Phone</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7}>{emptyText}</td>
            </tr>
          ) : (
            items.map((patient) => (
              <tr
                key={patient.id}
                data-selected={patient.id === selectedPatientId ? 'true' : 'false'}
              >
                <td>{patient.patientCode}</td>
                <td>{patient.displayName}</td>
                <td>{formatAgeDob(patient)}</td>
                <td>{patient.sex}</td>
                <td>{formatVillageQuarter(patient)}</td>
                <td>{patient.phone ?? 'Not recorded'}</td>
                <td>
                  <button
                    type="button"
                    className="button button-secondary patient-row-action"
                    onClick={() => onSelectPatient(patient.id)}
                  >
                    Select
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function PatientDetailPane({
  patient,
  draft,
  editMode,
  dirty,
  saving,
  conflictPatient,
  onDraftChange,
  onEdit,
  onSave,
  onCancel,
  onReload,
  onReloadLatest,
  onDiscardMyEdits,
  onContinueEditing
}: {
  readonly patient: PublicPatientDetail | null
  readonly draft: PatientEditableFields
  readonly editMode: boolean
  readonly dirty: boolean
  readonly saving: boolean
  readonly conflictPatient: PublicPatientDetail | null
  onDraftChange(draft: PatientEditableFields): void
  onEdit(): void
  onSave(): void
  onCancel(): void
  onReload(): void
  onReloadLatest(): void
  onDiscardMyEdits(): void
  onContinueEditing(): void
}): React.JSX.Element {
  return (
    <aside className="patient-detail-pane" aria-label="Selected patient">
      {patient === null ? (
        <p className="patient-empty">Select a patient to view or update details.</p>
      ) : editMode ? (
        <>
          <div className="patient-detail-header">
            <h2>{patient.patientCode}</h2>
            <span>{dirty ? 'Unsaved edits' : 'Editing'}</span>
          </div>
          {conflictPatient !== null ? (
            <div className="patient-conflict-review" role="status">
              <h3>Latest authoritative patient</h3>
              <dl className="patient-detail-list">
                <DetailRow label="Name" value={conflictPatient.displayName} />
                <DetailRow label="Age / DOB" value={formatAgeDob(conflictPatient)} />
                <DetailRow
                  label="Village / quarter"
                  value={formatVillageQuarter(conflictPatient)}
                />
                <DetailRow
                  label="Updated"
                  value={`${conflictPatient.updatedAt} by ${conflictPatient.updatedByDisplayName}`}
                />
              </dl>
              <div className="patient-detail-actions">
                <button type="button" className="button button-secondary" onClick={onReloadLatest}>
                  Reload latest
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={onDiscardMyEdits}
                >
                  Discard my edits
                </button>
                <button type="button" className="button button-primary" onClick={onContinueEditing}>
                  Continue editing
                </button>
              </div>
            </div>
          ) : null}
          <PatientFieldsForm draft={draft} disabled={saving} onDraftChange={onDraftChange} />
          <div className="patient-detail-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={onSave}
            >
              Save changes
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={saving}
              onClick={onReload}
            >
              Reload
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="patient-detail-header">
            <h2>{patient.patientCode}</h2>
            <button type="button" className="button button-secondary" onClick={onEdit}>
              Edit
            </button>
          </div>
          <dl className="patient-detail-list">
            <DetailRow label="Name" value={patient.displayName} />
            <DetailRow label="Age / DOB" value={formatAgeDob(patient)} />
            <DetailRow label="Sex" value={patient.sex} />
            <DetailRow label="Village / quarter" value={formatVillageQuarter(patient)} />
            <DetailRow label="Phone" value={patient.phone ?? 'Not recorded'} />
            <DetailRow label="Acknowledgment" value={patient.acknowledgment.status} />
            <DetailRow label="Clinical" value="Not available" />
            <DetailRow
              label="Created"
              value={`${patient.createdAt} by ${patient.createdByDisplayName}`}
            />
            <DetailRow
              label="Updated"
              value={`${patient.updatedAt} by ${patient.updatedByDisplayName}`}
            />
          </dl>
        </>
      )}
    </aside>
  )
}

function PatientFieldsForm({
  draft,
  disabled = false,
  mode = 'standard',
  validationErrors = {},
  inputRefs,
  onDraftChange
}: {
  readonly draft: PatientEditableFields
  readonly disabled?: boolean
  readonly mode?: 'standard' | 'registration'
  readonly validationErrors?: RegistrationValidationErrors
  readonly inputRefs?: {
    readonly givenName?: MutableRefObject<HTMLInputElement | null>
    readonly dateOfBirth?: MutableRefObject<HTMLInputElement | null>
    readonly approximateAgeYears?: MutableRefObject<HTMLInputElement | null>
    readonly ageAsOfDate?: MutableRefObject<HTMLInputElement | null>
  }
  onDraftChange(draft: PatientEditableFields): void
}): React.JSX.Element {
  const isRegistration = mode === 'registration'
  const exactDobActive = isRegistration && draft.dateOfBirth !== null
  const approximateAgeActive = isRegistration && draft.approximateAgeYears !== null
  const dobDisabled = disabled || approximateAgeActive
  const approximateAgeDisabled = disabled || exactDobActive
  const ageAsOfDateDisabled = disabled || exactDobActive || !approximateAgeActive
  const ageAsOfDateRequired = isRegistration && approximateAgeActive
  const exactDobDisabledDescriptionId = exactDobActive
    ? 'patient-registration-exact-dob-disabled-note'
    : undefined

  const update = <TKey extends keyof PatientEditableFields>(
    key: TKey,
    value: PatientEditableFields[TKey]
  ): void => {
    if (!isRegistration) {
      onDraftChange({ ...draft, [key]: value })
      return
    }

    onDraftChange(updateRegistrationDraftField(draft, key, value))
  }

  const nameFields = (
    <>
      <TextField
        inputRef={inputRefs?.givenName}
        id={isRegistration ? 'patient-registration-given-name' : undefined}
        label="Given name"
        value={draft.givenName}
        invalid={validationErrors.name !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                'patient-registration-name-help',
                validationErrors.name !== undefined ? validationErrorId('name') : undefined
              )
            : undefined
        }
        onChange={(value) => update('givenName', value)}
      />
      <TextField
        id={isRegistration ? 'patient-registration-family-name' : undefined}
        label="Family name"
        value={draft.familyName}
        invalid={validationErrors.name !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                'patient-registration-name-help',
                validationErrors.name !== undefined ? validationErrorId('name') : undefined
              )
            : undefined
        }
        onChange={(value) => update('familyName', value)}
      />
      <TextField
        id={isRegistration ? 'patient-registration-other-names' : undefined}
        label="Other names"
        value={draft.otherNames}
        invalid={validationErrors.name !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                'patient-registration-name-help',
                validationErrors.name !== undefined ? validationErrorId('name') : undefined
              )
            : undefined
        }
        onChange={(value) => update('otherNames', value)}
      />
    </>
  )

  const ageFields = (
    <>
      <DateField
        inputRef={inputRefs?.dateOfBirth}
        id={isRegistration ? 'patient-registration-date-of-birth' : undefined}
        label="Date of birth"
        value={draft.dateOfBirth}
        disabled={dobDisabled}
        invalid={validationErrors.dateOfBirth !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                validationErrors.dateOfBirth !== undefined
                  ? validationErrorId('dateOfBirth')
                  : undefined,
                validationErrors.approximateAgeYears !== undefined
                  ? validationErrorId('approximateAgeYears')
                  : undefined
              )
            : undefined
        }
        onChange={(value) => update('dateOfBirth', value)}
      />
      <NumberField
        inputRef={inputRefs?.approximateAgeYears}
        id={isRegistration ? 'patient-registration-approximate-age' : undefined}
        label="Approximate age"
        value={draft.approximateAgeYears}
        disabled={approximateAgeDisabled}
        invalid={validationErrors.approximateAgeYears !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                exactDobDisabledDescriptionId,
                validationErrors.approximateAgeYears !== undefined
                  ? validationErrorId('approximateAgeYears')
                  : undefined,
                validationErrors.dateOfBirth !== undefined
                  ? validationErrorId('dateOfBirth')
                  : undefined
              )
            : exactDobDisabledDescriptionId
        }
        onChange={(value) => update('approximateAgeYears', value)}
      />
      <DateField
        inputRef={inputRefs?.ageAsOfDate}
        id={isRegistration ? 'patient-registration-age-as-of-date' : undefined}
        label="Age as of date"
        value={draft.ageAsOfDate}
        disabled={ageAsOfDateDisabled}
        required={ageAsOfDateRequired}
        invalid={validationErrors.ageAsOfDate !== undefined}
        describedBy={
          isRegistration
            ? joinDescriptionIds(
                exactDobDisabledDescriptionId,
                validationErrors.ageAsOfDate !== undefined
                  ? validationErrorId('ageAsOfDate')
                  : undefined
              )
            : exactDobDisabledDescriptionId
        }
        onChange={(value) => update('ageAsOfDate', value)}
      />
    </>
  )

  return (
    <fieldset className="patient-fields-grid" disabled={disabled}>
      {isRegistration ? (
        <div
          className="patient-field-group patient-field-wide"
          role="group"
          aria-labelledby="patient-registration-name-label"
          aria-describedby={joinDescriptionIds(
            'patient-registration-name-help',
            validationErrors.name !== undefined ? validationErrorId('name') : undefined
          )}
          aria-required="true"
        >
          <div id="patient-registration-name-label" className="patient-field-group-label">
            Patient name <RequiredIndicator />
          </div>
          <p id="patient-registration-name-help" className="patient-field-help">
            At least one name field is required.
          </p>
          <div className="patient-field-group-grid">{nameFields}</div>
          <ValidationMessage field="name" errors={validationErrors} />
        </div>
      ) : (
        nameFields
      )}

      {isRegistration ? (
        <div
          className="patient-field-group patient-field-wide"
          role="group"
          aria-labelledby="patient-registration-age-label"
          aria-describedby={joinDescriptionIds(
            validationErrors.dateOfBirth !== undefined
              ? validationErrorId('dateOfBirth')
              : undefined,
            validationErrors.approximateAgeYears !== undefined
              ? validationErrorId('approximateAgeYears')
              : undefined,
            validationErrors.ageAsOfDate !== undefined
              ? validationErrorId('ageAsOfDate')
              : undefined
          )}
          aria-required="true"
        >
          <div id="patient-registration-age-label" className="patient-field-group-label">
            Date of birth or approximate age <RequiredIndicator />
          </div>
          <div className="patient-field-group-grid">{ageFields}</div>
          {exactDobActive ? (
            <p id="patient-registration-exact-dob-disabled-note" className="patient-field-help">
              Disabled because an exact date of birth is recorded.
            </p>
          ) : null}
          <ValidationMessage field="dateOfBirth" errors={validationErrors} />
          <ValidationMessage field="approximateAgeYears" errors={validationErrors} />
          <ValidationMessage field="ageAsOfDate" errors={validationErrors} />
        </div>
      ) : (
        ageFields
      )}

      <label>
        <span className="patient-field-label-text">Sex</span>
        <select
          value={draft.sex}
          onChange={(event) => update('sex', event.target.value as PatientEditableFields['sex'])}
        >
          <option value="UNKNOWN">Unknown</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <TextField
        label="Village"
        value={draft.village}
        onChange={(value) => update('village', value)}
      />
      <TextField
        label="Quarter"
        value={draft.quarter}
        onChange={(value) => update('quarter', value)}
      />
      <TextField label="Phone" value={draft.phone} onChange={(value) => update('phone', value)} />
      <TextField
        label="Alternate contact"
        value={draft.alternateContactName}
        onChange={(value) => update('alternateContactName', value)}
      />
      <TextField
        label="Alternate phone"
        value={draft.alternateContactPhone}
        onChange={(value) => update('alternateContactPhone', value)}
      />
      <label className="patient-field-wide">
        <span className="patient-field-label-text">Residence notes</span>
        <textarea
          value={draft.residenceNotes ?? ''}
          onChange={(event) => update('residenceNotes', emptyToNull(event.target.value))}
        />
      </label>
      <label>
        <span className="patient-field-label-text">Status</span>
        <select
          value={draft.status}
          onChange={(event) =>
            update('status', event.target.value as PatientEditableFields['status'])
          }
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      <label>
        <span className="patient-field-label-text">Acknowledgment</span>
        <select
          value={draft.acknowledgmentStatus}
          onChange={(event) =>
            update(
              'acknowledgmentStatus',
              event.target.value as PatientEditableFields['acknowledgmentStatus']
            )
          }
        >
          <option value="NOT_REQUESTED">Not requested</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="DECLINED">Declined</option>
        </select>
      </label>
    </fieldset>
  )
}

function TextField({
  id,
  inputRef,
  label,
  value,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly id?: string
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>
  readonly label: string
  readonly value: string | null
  readonly disabled?: boolean
  readonly required?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <FieldLabelText label={label} required={required} />
      <input
        id={id}
        ref={inputRef}
        value={value ?? ''}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </label>
  )
}

function DateField({
  id,
  inputRef,
  label,
  value,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly id?: string
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>
  readonly label: string
  readonly value: string | null
  readonly disabled?: boolean
  readonly required?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <FieldLabelText label={label} required={required} />
      <input
        id={id}
        ref={inputRef}
        type="date"
        value={value ?? ''}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </label>
  )
}

function NumberField({
  id,
  inputRef,
  label,
  value,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly id?: string
  readonly inputRef?: MutableRefObject<HTMLInputElement | null>
  readonly label: string
  readonly value: number | null
  readonly disabled?: boolean
  readonly required?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: number | null): void
}): React.JSX.Element {
  return (
    <label>
      <FieldLabelText label={label} required={required} />
      <input
        id={id}
        ref={inputRef}
        type="number"
        min={0}
        max={120}
        value={value ?? ''}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </label>
  )
}

function FieldLabelText({
  label,
  required
}: {
  readonly label: string
  readonly required: boolean
}): React.JSX.Element {
  return (
    <>
      <span className="patient-field-label-text">{label}</span>
      {required ? <RequiredIndicator /> : null}
    </>
  )
}

function RequiredIndicator(): React.JSX.Element {
  return (
    <span className="patient-required-indicator">
      <span aria-hidden="true">*</span>
      <span className="visually-hidden"> required</span>
    </span>
  )
}

function ValidationMessage({
  field,
  errors
}: {
  readonly field: RegistrationValidationField
  readonly errors: RegistrationValidationErrors
}): React.JSX.Element | null {
  const message = errors[field]

  if (message === undefined) {
    return null
  }

  return (
    <p id={validationErrorId(field)} className="patient-field-error">
      {message}
    </p>
  )
}

function DuplicatePatientCard({
  patient,
  matchedOn,
  children
}: {
  readonly patient: PublicPatientSummary
  readonly matchedOn?: readonly string[]
  readonly children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="patient-duplicate-card">
      <strong>{patient.patientCode}</strong>
      <span>{patient.displayName}</span>
      <span>{formatAgeDob(patient)}</span>
      <span>{formatVillageQuarter(patient)}</span>
      {matchedOn !== undefined ? (
        <span className="patient-match-reasons">
          Match reasons: {formatMatchReasons(matchedOn)}
        </span>
      ) : null}
      {children !== undefined ? (
        <div className="patient-duplicate-card-actions">{children}</div>
      ) : null}
    </div>
  )
}

function PatientModalDialog({
  title,
  pending,
  onCancel,
  children
}: {
  readonly title: string
  readonly pending: boolean
  onCancel(): void
  readonly children: ReactNode
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const previousFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement
    headingRef.current?.focus({ preventScroll: true })

    return () => {
      const previousFocus = previousFocusRef.current

      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  return (
    <div className="patient-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="patient-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !pending) {
            event.preventDefault()
            onCancel()
            return
          }

          if (event.key === 'Tab') {
            trapDialogFocus(event, dialogRef.current)
          }
        }}
      >
        <h2 ref={headingRef} id="patient-dialog-title" tabIndex={-1}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function detailToEditable(patient: PublicPatientDetail): PatientEditableFields {
  return {
    givenName: patient.givenName,
    familyName: patient.familyName,
    otherNames: patient.otherNames,
    dateOfBirth: patient.dateOfBirth,
    approximateAgeYears: patient.approximateAgeYears,
    ageAsOfDate: patient.ageAsOfDate,
    sex: patient.sex,
    village: patient.village,
    quarter: patient.quarter,
    phone: patient.phone,
    alternateContactName: patient.alternateContactName,
    alternateContactPhone: patient.alternateContactPhone,
    residenceNotes: patient.residenceNotes,
    status: patient.status,
    acknowledgmentStatus: patient.acknowledgment.status
  }
}

function updateRegistrationDraftField<TKey extends keyof PatientEditableFields>(
  draft: PatientEditableFields,
  key: TKey,
  value: PatientEditableFields[TKey]
): PatientEditableFields {
  const nextDraft: PatientEditableFields = { ...draft, [key]: value }

  if (key === 'dateOfBirth' && typeof value === 'string' && isValidLocalDate(value)) {
    return {
      ...nextDraft,
      approximateAgeYears: null,
      ageAsOfDate: null
    }
  }

  if (key === 'approximateAgeYears') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return {
        ...nextDraft,
        dateOfBirth: null,
        ageAsOfDate: draft.ageAsOfDate ?? getCurrentLocalDate()
      }
    }

    return {
      ...nextDraft,
      ageAsOfDate: null
    }
  }

  return nextDraft
}

function normalizeAgeEntryForSubmit(draft: PatientEditableFields): PatientEditableFields {
  if (draft.dateOfBirth !== null) {
    return {
      ...draft,
      approximateAgeYears: null,
      ageAsOfDate: null
    }
  }

  if (draft.approximateAgeYears === null) {
    return {
      ...draft,
      ageAsOfDate: null
    }
  }

  return {
    ...draft,
    dateOfBirth: null
  }
}

function validateRegistrationDraft(draft: PatientEditableFields): {
  readonly errors: RegistrationValidationErrors
  readonly focusField: RegistrationFocusField | null
} {
  const errors: RegistrationValidationErrors = {}
  let focusField: RegistrationFocusField | null = null
  const hasName = [draft.givenName, draft.familyName, draft.otherNames].some(isPresentText)
  const hasDateOfBirth = draft.dateOfBirth !== null
  const hasApproximateAge = draft.approximateAgeYears !== null
  const today = getCurrentLocalDate()

  const setFocus = (field: RegistrationFocusField): void => {
    focusField ??= field
  }

  if (!hasName) {
    errors.name = 'At least one name field is required.'
    setFocus('givenName')
  }

  if (hasDateOfBirth && hasApproximateAge) {
    errors.dateOfBirth = 'Use either date of birth or approximate age, not both.'
    errors.approximateAgeYears = 'Use either approximate age or date of birth, not both.'
    setFocus('dateOfBirth')
  }

  if (!hasDateOfBirth && !hasApproximateAge) {
    errors.dateOfBirth = 'Enter a date of birth or approximate age.'
    errors.approximateAgeYears = 'Enter a date of birth or approximate age.'
    setFocus('dateOfBirth')
  }

  if (
    draft.dateOfBirth !== null &&
    (!isValidLocalDate(draft.dateOfBirth) || draft.dateOfBirth > today)
  ) {
    errors.dateOfBirth = 'Date of birth must be today or earlier.'
    setFocus('dateOfBirth')
  }

  if (
    draft.approximateAgeYears !== null &&
    (!Number.isInteger(draft.approximateAgeYears) ||
      draft.approximateAgeYears < 0 ||
      draft.approximateAgeYears > 120)
  ) {
    errors.approximateAgeYears = 'Approximate age must be between 0 and 120.'
    setFocus('approximateAgeYears')
  }

  if (draft.approximateAgeYears !== null && draft.ageAsOfDate === null) {
    errors.ageAsOfDate = 'Age as of date is required when approximate age is used.'
    setFocus('ageAsOfDate')
  }

  if (
    draft.ageAsOfDate !== null &&
    (!isValidLocalDate(draft.ageAsOfDate) || draft.ageAsOfDate > today)
  ) {
    errors.ageAsOfDate = 'Age as of date must be today or earlier.'
    setFocus('ageAsOfDate')
  }

  return { errors, focusField }
}

function getPatientSearchEmptyText(state: LoadState, failureMessage: string | null): string {
  switch (state) {
    case 'IDLE':
      return 'Enter search terms, then press Search.'
    case 'LOADING':
      return 'Searching patients.'
    case 'ERROR':
      return failureMessage ?? 'Patient search failed.'
    case 'EMPTY':
      return 'No matching patients.'
    case 'READY':
      return 'No matching patients.'
  }
}

function getRecentEmptyText(state: LoadState, failureMessage: string | null): string {
  switch (state) {
    case 'IDLE':
    case 'LOADING':
      return 'Loading recent patients.'
    case 'ERROR':
      return failureMessage ?? 'Recent patients failed to load.'
    case 'EMPTY':
    case 'READY':
      return 'No recent patients.'
  }
}

function getDuplicatePairsEmptyText(state: LoadState, failureMessage: string | null): string {
  switch (state) {
    case 'IDLE':
    case 'LOADING':
      return 'Loading possible duplicates.'
    case 'ERROR':
      return failureMessage ?? 'Possible duplicates failed to load.'
    case 'EMPTY':
    case 'READY':
      return 'No possible duplicates.'
  }
}

function formatAgeDob(patient: PublicPatientSummary): string {
  if (patient.dateOfBirth !== null) {
    return patient.dateOfBirth
  }

  if (patient.approximateAgeYears !== null) {
    return `${patient.approximateAgeYears} as of ${patient.ageAsOfDate ?? 'unknown'}`
  }

  return 'Not recorded'
}

function formatVillageQuarter(patient: PublicPatientSummary): string {
  return [patient.village, patient.quarter].filter(Boolean).join(' / ') || 'Not recorded'
}

function formatMatchReasons(matchedOn: readonly string[]): string {
  return matchedOn.map(formatMatchReason).join(', ')
}

function formatMatchReason(reason: string): string {
  switch (reason) {
    case 'phone':
      return 'phone'
    case 'date_of_birth':
      return 'date of birth'
    case 'sex':
      return 'sex'
    case 'village':
      return 'village'
    case 'name':
      return 'name'
    case 'approximate_age':
      return 'approximate age'
    default:
      return reason.replaceAll('_', ' ')
  }
}

function validationErrorId(field: RegistrationValidationField): string {
  return `patient-registration-${field}-error`
}

function joinDescriptionIds(...ids: readonly (string | undefined)[]): string | undefined {
  const joined = ids.filter((id): id is string => id !== undefined).join(' ')

  return joined.length === 0 ? undefined : joined
}

function getCurrentLocalDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isValidLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false
  }

  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(year, month - 1, day)

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()

  return trimmed.length === 0 ? null : value
}

function isPresentText(value: string | null): boolean {
  return value !== null && value.trim().length > 0
}

function isPatientCommand(commandId: ApplicationCommandId): commandId is PatientCommandId {
  return commandId.startsWith('PATIENTS_')
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

function trapDialogFocus(
  event: ReactKeyboardEvent<HTMLDivElement>,
  dialog: HTMLElement | null
): void {
  if (dialog === null) {
    return
  }

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  )

  if (focusable.length === 0) {
    event.preventDefault()
    dialog.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
    return
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
