import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  ReactNode,
  RefObject
} from 'react'

import type {
  HealthScreeningApi,
  LocalUserRole,
  PatientEditableFields,
  PatientDemographicAmendmentReasonCode,
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
import { PatientCurrentDetailsPanel } from './PatientCurrentDetailsPanel'
import {
  PatientDemographicAmendmentForm,
  type PatientDemographicAmendmentConflictView
} from './PatientDemographicAmendmentForm'
import { PatientDetailTabs, type PatientDetailTab } from './PatientDetailTabs'
import {
  applyPatientDemographicPatchToDraft,
  createPatientDemographicDraft,
  createPatientDemographicPatch,
  getPatientDemographicConflictFields,
  validatePatientDemographicAmendment,
  type PatientDemographicAmendmentReasonSelection,
  type PatientDemographicAmendmentValidationErrors,
  type PatientDemographicDraft
} from './patient-demographic-amendment'

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
  readonly userRole: LocalUserRole
  readonly selectedPatient: PublicPatientDetail | null
  onSelectedPatientChange(patient: PublicPatientDetail | null): void
  onPatientAuthenticationFailure(code: PatientErrorCode): void
  onSelectCommand(commandId: ApplicationCommandId): void
  registerNavigationGuard(guard: PatientWorkspaceNavigationGuard | null): void
}

type LoadState = 'IDLE' | 'LOADING' | 'READY' | 'EMPTY' | 'ERROR'
type PatientStateInvalidator = () => void
type RegisterPatientStateInvalidator = (invalidator: PatientStateInvalidator) => () => void
type PatientSearchPageSize = 25 | 50 | 100
type RegistrationValidationField = 'name' | 'dateOfBirth' | 'approximateAgeYears' | 'ageAsOfDate'
type RegistrationValidationErrors = Partial<Record<RegistrationValidationField, string>>
type RegistrationFocusField = 'givenName' | 'dateOfBirth' | 'approximateAgeYears' | 'ageAsOfDate'

interface PreferredPatientReveal {
  readonly patient: PublicPatientSummary
}

interface PatientSearchDisplaySnapshot {
  readonly items: readonly PublicPatientSummary[]
  readonly total: number
  readonly page: number
  readonly pageSize: PatientSearchPageSize
  readonly appliedQuery: string
  readonly state: LoadState
  readonly failureMessage: string | null
}

interface PatientSearchResultSnapshot {
  readonly requestId: number
  readonly securityEpoch: number
  readonly queryText: string
  readonly items: readonly PublicPatientSummary[]
  readonly total: number
  readonly page: number
  readonly pageSize: PatientSearchPageSize
  readonly targetPatientId: string | null
  readonly preferredPatientIdToConsume: string | null
}

const transportFailureMessage = 'The desktop service is unavailable.'
const patientSearchDebounceMs = 300
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
  userRole,
  selectedPatient,
  onSelectedPatientChange,
  onPatientAuthenticationFailure,
  onSelectCommand,
  registerNavigationGuard
}: PatientRegistryWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const securityEpochRef = useRef(0)
  const patientStateInvalidatorsRef = useRef(new Set<PatientStateInvalidator>())
  const [amendmentMode, setAmendmentMode] = useState(false)
  const [amendmentBase, setAmendmentBase] = useState<PublicPatientDetail | null>(null)
  const [demographicDraft, setDemographicDraft] = useState<PatientDemographicDraft | null>(null)
  const [amendmentReasonCode, setAmendmentReasonCode] =
    useState<PatientDemographicAmendmentReasonSelection>('')
  const [amendmentReasonNote, setAmendmentReasonNote] = useState('')
  const [amendmentValidationErrors, setAmendmentValidationErrors] =
    useState<PatientDemographicAmendmentValidationErrors>({})
  const [amendmentConflict, setAmendmentConflict] =
    useState<PatientDemographicAmendmentConflictView | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [amendmentSaving, setAmendmentSaving] = useState(false)
  const [showDirtyGuard, setShowDirtyGuard] = useState(false)
  const [preferredPatientReveal, setPreferredPatientReveal] =
    useState<PreferredPatientReveal | null>(null)
  const [demographicHistoryRevision, setDemographicHistoryRevision] = useState(0)
  const pendingDirtyAction = useRef<(() => void) | null>(null)
  const pendingDirtyActionNeedsNavigationBypassRef = useRef(false)
  const allowResolvedDirtyNavigationRef = useRef(false)
  const patientLoadRequestRef = useRef(0)
  const amendmentRequestRef = useRef(0)
  const amendmentSubmissionPendingRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const messageRef = useRef<HTMLDivElement | null>(null)
  const [activeDetailTab, setActiveDetailTab] = useState<PatientDetailTab>('CURRENT_DETAILS')
  const previousSelectedPatientIdRef = useRef<string | null>(selectedPatient?.id ?? null)
  const selectedPatientIdRef = useLatestRef(selectedPatient?.id ?? null)
  const amendmentPatch =
    amendmentMode && amendmentBase !== null && demographicDraft !== null
      ? createPatientDemographicPatch(amendmentBase, demographicDraft)
      : null
  const amendmentDirty =
    amendmentMode &&
    (amendmentPatch !== null ||
      amendmentReasonCode !== '' ||
      amendmentReasonNote.length > 0 ||
      amendmentConflict !== null)

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

  const clearAmendmentState = useCallback((): void => {
    amendmentRequestRef.current += 1
    amendmentSubmissionPendingRef.current = false
    setAmendmentMode(false)
    setAmendmentBase(null)
    setDemographicDraft(null)
    setAmendmentReasonCode('')
    setAmendmentReasonNote('')
    setAmendmentValidationErrors({})
    setAmendmentConflict(null)
    setAmendmentSaving(false)
  }, [])

  const focusMessage = useCallback((): void => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        messageRef.current?.focus({ preventScroll: true })
      }
    })
  }, [mountedRef])

  const clearProtectedPatientState = useCallback((): void => {
    invalidateProtectedPatientState()
    for (const invalidatePatientState of Array.from(patientStateInvalidatorsRef.current)) {
      invalidatePatientState()
    }
    clearAmendmentState()
    onSelectedPatientChange(null)
    setPreferredPatientReveal(null)
    setActiveDetailTab('CURRENT_DETAILS')
    pendingDirtyAction.current = null
    pendingDirtyActionNeedsNavigationBypassRef.current = false
    allowResolvedDirtyNavigationRef.current = false
    setShowDirtyGuard(false)
  }, [clearAmendmentState, invalidateProtectedPatientState, onSelectedPatientChange])

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
      if (!amendmentDirty) {
        action()
        return true
      }

      pendingDirtyAction.current = action
      pendingDirtyActionNeedsNavigationBypassRef.current = false
      setShowDirtyGuard(true)
      return false
    },
    [amendmentDirty]
  )

  useEffect(() => {
    const nextSelectedPatientId = selectedPatient?.id ?? null

    if (previousSelectedPatientIdRef.current !== nextSelectedPatientId) {
      previousSelectedPatientIdRef.current = nextSelectedPatientId
      setActiveDetailTab('CURRENT_DETAILS')
    }
  }, [selectedPatient?.id])

  const selectDetailTab = useCallback(
    (tab: PatientDetailTab): void => {
      if (tab === activeDetailTab) {
        return
      }

      if (activeDetailTab === 'CURRENT_DETAILS' && amendmentDirty) {
        beginDirtyGuard(() => setActiveDetailTab(tab))
        return
      }

      setActiveDetailTab(tab)
    },
    [activeDetailTab, amendmentDirty, beginDirtyGuard]
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

      if (!amendmentDirty) {
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
  }, [amendmentDirty, commandId, onSelectCommand, registerNavigationGuard])

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

        setActiveDetailTab('CURRENT_DETAILS')
        clearAmendmentState()
        onSelectedPatientChange(result.data)
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
    [api, clearAmendmentState, handlePatientFailure, isCurrentOperation, onSelectedPatientChange]
  )

  const selectPatient = useCallback(
    (patientId: string): void => {
      beginDirtyGuard(() => {
        void loadAndSelectPatient(patientId)
      })
    },
    [beginDirtyGuard, loadAndSelectPatient]
  )

  const clearSelectedPatient = useCallback((): void => {
    patientLoadRequestRef.current += 1
    setActiveDetailTab('CURRENT_DETAILS')
    clearAmendmentState()
    onSelectedPatientChange(null)
  }, [clearAmendmentState, onSelectedPatientChange])

  const applyPatientSearchTarget = useCallback(
    (patientId: string | null): void => {
      if (patientId === null) {
        clearSelectedPatient()
        return
      }

      if (selectedPatient?.id !== patientId) {
        void loadAndSelectPatient(patientId)
      }
    },
    [clearSelectedPatient, loadAndSelectPatient, selectedPatient?.id]
  )

  const startDemographicAmendment = useCallback((): void => {
    if (selectedPatient === null) {
      return
    }

    amendmentRequestRef.current += 1
    amendmentSubmissionPendingRef.current = false
    setActiveDetailTab('CURRENT_DETAILS')
    setAmendmentBase(selectedPatient)
    setDemographicDraft(createPatientDemographicDraft(selectedPatient))
    setAmendmentReasonCode('')
    setAmendmentReasonNote('')
    setAmendmentValidationErrors({})
    setAmendmentConflict(null)
    setAmendmentSaving(false)
    setAmendmentMode(true)
    setMessage(null)
  }, [selectedPatient])

  const submitAmendment = useCallback(async (): Promise<boolean> => {
    if (
      selectedPatient === null ||
      amendmentBase === null ||
      demographicDraft === null ||
      amendmentSubmissionPendingRef.current
    ) {
      return false
    }

    const validation = validatePatientDemographicAmendment({
      basePatient: amendmentBase,
      draft: demographicDraft,
      reasonCode: amendmentReasonCode,
      reasonNote: amendmentReasonNote,
      userRole,
      today: getCurrentLocalDate()
    })

    setAmendmentValidationErrors(validation.errors)

    if (validation.patch === null || validation.focusField !== null || amendmentReasonCode === '') {
      return false
    }

    const requestReasonCode: PatientDemographicAmendmentReasonCode = amendmentReasonCode
    const requestId = amendmentRequestRef.current + 1
    amendmentRequestRef.current = requestId
    amendmentSubmissionPendingRef.current = true
    const startedSecurityEpoch = securityEpochRef.current
    const startedPatientId = selectedPatient.id
    setMessage(null)
    setAmendmentSaving(true)

    try {
      const result = await api.patient.amendDemographics({
        patientId: startedPatientId,
        expectedRowVersion: amendmentBase.rowVersion,
        reasonCode: requestReasonCode,
        reasonNote: validation.normalizedReasonNote,
        patch: validation.patch
      })

      if (
        !isCurrentOperation(startedSecurityEpoch) ||
        amendmentRequestRef.current !== requestId ||
        selectedPatientIdRef.current !== startedPatientId
      ) {
        return false
      }

      if (!result.ok) {
        handlePatientFailure(result.error.code, result.error.message)
        return false
      }

      if (result.data.status === 'PATIENT_VERSION_CONFLICT') {
        const latestPatient = result.data.patient
        const intendedPatch = validation.patch
        const overlappingFields = getPatientDemographicConflictFields(
          amendmentBase,
          latestPatient,
          intendedPatch
        )

        onSelectedPatientChange(latestPatient)
        setAmendmentBase(latestPatient)
        setDemographicDraft(
          applyPatientDemographicPatchToDraft(latestPatient, intendedPatch, userRole)
        )
        setAmendmentConflict({
          latestUpdatedAt: latestPatient.updatedAt,
          latestUpdatedByDisplayName: latestPatient.updatedByDisplayName,
          overlappingFields
        })
        setAmendmentValidationErrors({})
        setAmendmentMode(true)
        setMessage('The patient changed after you opened it. Review the latest details.')
        return false
      }

      onSelectedPatientChange(result.data.patient)
      clearAmendmentState()
      setActiveDetailTab('CURRENT_DETAILS')
      setDemographicHistoryRevision((revision) => revision + 1)
      setMessage('Demographic amendment recorded.')
      focusMessage()
      return true
    } catch {
      if (
        isCurrentOperation(startedSecurityEpoch) &&
        selectedPatientIdRef.current === startedPatientId
      ) {
        setMessage(transportFailureMessage)
      }

      return false
    } finally {
      if (
        isCurrentOperation(startedSecurityEpoch) &&
        amendmentRequestRef.current === requestId &&
        selectedPatientIdRef.current === startedPatientId
      ) {
        amendmentSubmissionPendingRef.current = false
        setAmendmentSaving(false)
      }
    }
  }, [
    api,
    amendmentBase,
    amendmentReasonCode,
    amendmentReasonNote,
    clearAmendmentState,
    demographicDraft,
    focusMessage,
    handlePatientFailure,
    isCurrentOperation,
    onSelectedPatientChange,
    selectedPatient,
    selectedPatientIdRef,
    userRole
  ])

  const discardAmendment = useCallback((): void => {
    clearAmendmentState()
    setMessage(null)
  }, [clearAmendmentState])

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
        <div ref={messageRef} className="patient-alert" role="status" tabIndex={-1}>
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
            setActiveDetailTab('CURRENT_DETAILS')
            clearAmendmentState()
            onSelectedPatientChange(patient)
            setPreferredPatientReveal({ patient })
            setMessage('Patient created.')
            onSelectCommand('PATIENTS_PATIENT_SEARCH')
          }}
          onOpenPatient={(patient) => {
            setPreferredPatientReveal({ patient })
            onSelectCommand('PATIENTS_PATIENT_SEARCH')
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
                preferredPatientReveal={preferredPatientReveal}
                searchInputRef={searchInputRef}
                onPatientFailure={handlePatientFailure}
                onSelectPatient={selectPatient}
                onApplyPatientSearchTarget={applyPatientSearchTarget}
                onGuardPatientContextTransition={beginDirtyGuard}
                onPreferredPatientRevealConsumed={(patientId) => {
                  setPreferredPatientReveal((currentReveal) =>
                    currentReveal?.patient.id === patientId ? null : currentReveal
                  )
                }}
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
            api={api}
            patient={selectedPatient}
            amendmentMode={amendmentMode}
            amendmentBase={amendmentBase}
            demographicDraft={demographicDraft}
            amendmentReasonCode={amendmentReasonCode}
            amendmentReasonNote={amendmentReasonNote}
            amendmentValidationErrors={amendmentValidationErrors}
            amendmentConflict={amendmentConflict}
            amendmentSaving={amendmentSaving}
            activeTab={activeDetailTab}
            userRole={userRole}
            demographicHistoryRevision={demographicHistoryRevision}
            securityEpochRef={securityEpochRef}
            registerStateInvalidator={registerPatientStateInvalidator}
            onPatientFailure={handlePatientFailure}
            onSelectTab={selectDetailTab}
            onDraftChange={(nextDraft) => {
              setDemographicDraft(nextDraft)
              setAmendmentValidationErrors({})
            }}
            onReasonCodeChange={(nextReasonCode) => {
              setAmendmentReasonCode(nextReasonCode)
              setAmendmentValidationErrors({})
            }}
            onReasonNoteChange={(nextReasonNote) => {
              setAmendmentReasonNote(nextReasonNote)
              setAmendmentValidationErrors({})
            }}
            onEdit={startDemographicAmendment}
            onSave={() => {
              void submitAmendment()
            }}
            onCancel={() => {
              if (amendmentDirty) {
                beginDirtyGuard(discardAmendment)
                return
              }

              discardAmendment()
            }}
            onReload={() => {
              if (selectedPatient !== null) {
                beginDirtyGuard(() => {
                  void loadAndSelectPatient(selectedPatient.id)
                })
              }
            }}
            onReviewConflict={() => {
              setAmendmentConflict(null)
              setMessage('Review the rebased amendment.')
            }}
            onRetryConflict={() => {
              setAmendmentConflict(null)
              void submitAmendment()
            }}
            onDiscardConflict={() => {
              discardAmendment()
              setMessage('Loaded the latest patient details.')
            }}
            onCancelConflict={() => {
              setAmendmentConflict(null)
              setMessage('Continue editing your rebased amendment.')
            }}
          />
        </div>
      )}

      {showDirtyGuard ? (
        <PatientModalDialog
          title="Unsaved patient amendment"
          pending={amendmentSaving}
          onCancel={() => {
            pendingDirtyAction.current = null
            pendingDirtyActionNeedsNavigationBypassRef.current = false
            allowResolvedDirtyNavigationRef.current = false
            setShowDirtyGuard(false)
          }}
        >
          <p className="patient-dialog-copy">Save or discard the amendment before leaving.</p>
          <div className="patient-dialog-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={amendmentSaving}
              onClick={() => {
                void submitAmendment().then((saved) => {
                  if (saved) {
                    completePendingDirtyAction()
                  }
                })
              }}
            >
              Save amendment
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={amendmentSaving}
              onClick={() => {
                discardAmendment()
                completePendingDirtyAction()
              }}
            >
              Discard amendment
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={amendmentSaving}
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
  preferredPatientReveal,
  searchInputRef,
  onPatientFailure,
  onSelectPatient,
  onApplyPatientSearchTarget,
  onGuardPatientContextTransition,
  onPreferredPatientRevealConsumed,
  onRegister
}: {
  readonly api: HealthScreeningApi
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  readonly selectedPatientId: string | null
  readonly preferredPatientReveal: PreferredPatientReveal | null
  readonly searchInputRef: RefObject<HTMLInputElement | null>
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectPatient(patientId: string): void
  onApplyPatientSearchTarget(patientId: string | null): void
  onGuardPatientContextTransition(action: () => void): boolean
  onPreferredPatientRevealConsumed(patientId: string): void
  onRegister(): void
}): React.JSX.Element {
  const mountedRef = useMountedRef()
  const requestRef = useRef(0)
  const initialLoadStartedRef = useRef(false)
  const debounceTimerRef = useRef<number | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [pageSize, setPageSize] = useState<PatientSearchPageSize>(25)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<readonly PublicPatientSummary[]>([])
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<LoadState>('IDLE')
  const [failureMessage, setFailureMessage] = useState<string | null>(null)
  const stableDisplaySnapshotRef = useRef<PatientSearchDisplaySnapshot>(
    createPatientSearchDisplaySnapshot({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      appliedQuery: '',
      state: 'IDLE',
      failureMessage: null
    })
  )
  const selectedPatientIdRef = useLatestRef(selectedPatientId)
  const preferredPatientRevealRef = useLatestRef(preferredPatientReveal)
  const queryInputRef = useLatestRef(queryInput)
  const appliedQueryRef = useLatestRef(appliedQuery)
  const pageSizeRef = useLatestRef(pageSize)

  const clearDebounceTimer = useCallback((): void => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
  }, [])

  const applySearchDisplaySnapshot = useCallback((snapshot: PatientSearchDisplaySnapshot): void => {
    stableDisplaySnapshotRef.current = snapshot
    setItems(snapshot.items)
    setTotal(snapshot.total)
    setPage(snapshot.page)
    setPageSize(snapshot.pageSize)
    setAppliedQuery(snapshot.appliedQuery)
    setState(snapshot.state)
    setFailureMessage(snapshot.failureMessage)
  }, [])

  const invalidateLocalState = useCallback((): void => {
    clearDebounceTimer()
    requestRef.current += 1
    setQueryInput('')
    applySearchDisplaySnapshot(
      createPatientSearchDisplaySnapshot({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        appliedQuery: '',
        state: 'IDLE',
        failureMessage: null
      })
    )
  }, [applySearchDisplaySnapshot, clearDebounceTimer])

  useEffect(
    () => registerStateInvalidator(invalidateLocalState),
    [invalidateLocalState, registerStateInvalidator]
  )

  const applySearchResultSnapshot = useCallback(
    (snapshot: PatientSearchResultSnapshot): void => {
      if (
        !mountedRef.current ||
        securityEpochRef.current !== snapshot.securityEpoch ||
        requestRef.current !== snapshot.requestId
      ) {
        return
      }

      applySearchDisplaySnapshot(
        createPatientSearchDisplaySnapshot({
          items: snapshot.items,
          total: snapshot.total,
          page: snapshot.page,
          pageSize: snapshot.pageSize,
          appliedQuery: snapshot.queryText,
          state: snapshot.items.length === 0 ? 'EMPTY' : 'READY',
          failureMessage: null
        })
      )

      if (snapshot.preferredPatientIdToConsume !== null) {
        onPreferredPatientRevealConsumed(snapshot.preferredPatientIdToConsume)
      }

      if (selectedPatientIdRef.current !== snapshot.targetPatientId) {
        onApplyPatientSearchTarget(snapshot.targetPatientId)
      }
    },
    [
      applySearchDisplaySnapshot,
      mountedRef,
      onApplyPatientSearchTarget,
      onPreferredPatientRevealConsumed,
      securityEpochRef,
      selectedPatientIdRef
    ]
  )

  const executeSearch = useCallback(
    async ({
      queryText,
      pageNumber,
      pageSizeValue
    }: {
      readonly queryText: string
      readonly pageNumber: number
      readonly pageSizeValue: PatientSearchPageSize
    }): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      const startedSecurityEpoch = securityEpochRef.current
      const previousDisplaySnapshot = stableDisplaySnapshotRef.current
      setState('LOADING')
      setFailureMessage(null)

      try {
        const result = await api.patient.search({
          query: queryText,
          page: pageNumber,
          pageSize: pageSizeValue
        })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          requestRef.current !== requestId
        ) {
          return
        }

        if (!result.ok) {
          if (onPatientFailure(result.error.code, result.error.message)) {
            clearDebounceTimer()
            return
          }

          applySearchDisplaySnapshot(
            createPatientSearchDisplaySnapshot({
              items: [],
              total: 0,
              page: pageNumber,
              pageSize: pageSizeValue,
              appliedQuery: queryText,
              state: 'ERROR',
              failureMessage: result.error.message
            })
          )
          return
        }

        const preferredReveal = preferredPatientRevealRef.current
        const preferredPatient = preferredReveal?.patient ?? null
        const visibleItems =
          preferredPatient === null
            ? result.data.items
            : revealPatientInSearchItems(result.data.items, preferredPatient, pageSizeValue)
        const visibleTotal =
          preferredPatient === null || visibleItems === result.data.items
            ? result.data.total
            : Math.max(result.data.total, visibleItems.length)
        const preferredPatientId = preferredPatient?.id ?? null
        const targetPatientId = getPatientSearchTargetPatientId(
          visibleItems,
          selectedPatientIdRef.current,
          preferredPatientId
        )
        const preferredPatientIdToConsume =
          preferredPatientId !== null &&
          targetPatientId === preferredPatientId &&
          visibleItems.some((patient) => patient.id === preferredPatientId)
            ? preferredPatientId
            : null

        const snapshot = createPatientSearchResultSnapshot({
          requestId,
          securityEpoch: startedSecurityEpoch,
          queryText,
          items: visibleItems,
          total: visibleTotal,
          page: result.data.page,
          pageSize: pageSizeValue,
          targetPatientId,
          preferredPatientIdToConsume
        })

        if (selectedPatientIdRef.current === snapshot.targetPatientId) {
          applySearchResultSnapshot(snapshot)
          return
        }

        const appliedImmediately = onGuardPatientContextTransition(() => {
          applySearchResultSnapshot(snapshot)
        })

        if (!appliedImmediately) {
          applySearchDisplaySnapshot(previousDisplaySnapshot)
        }
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          requestRef.current === requestId
        ) {
          applySearchDisplaySnapshot(
            createPatientSearchDisplaySnapshot({
              items: [],
              total: 0,
              page: pageNumber,
              pageSize: pageSizeValue,
              appliedQuery: queryText,
              state: 'ERROR',
              failureMessage: transportFailureMessage
            })
          )
        }
      }
    },
    [
      api,
      applySearchDisplaySnapshot,
      applySearchResultSnapshot,
      clearDebounceTimer,
      mountedRef,
      onGuardPatientContextTransition,
      onPatientFailure,
      preferredPatientRevealRef,
      securityEpochRef,
      selectedPatientIdRef
    ]
  )

  const runImmediateSearch = useCallback(
    ({
      queryText,
      pageNumber,
      pageSizeValue
    }: {
      readonly queryText: string
      readonly pageNumber: number
      readonly pageSizeValue: PatientSearchPageSize
    }): void => {
      clearDebounceTimer()
      void executeSearch({
        queryText: normalizePatientSearchQuery(queryText),
        pageNumber,
        pageSizeValue
      })
    },
    [clearDebounceTimer, executeSearch]
  )

  const handleQueryInputChange = useCallback(
    (nextQueryInput: string): void => {
      setQueryInput(nextQueryInput)
      clearDebounceTimer()
      requestRef.current += 1
      applySearchDisplaySnapshot(stableDisplaySnapshotRef.current)

      const normalizedQuery = normalizePatientSearchQuery(nextQueryInput)

      if (normalizedQuery.length === 0) {
        void executeSearch({
          queryText: '',
          pageNumber: 1,
          pageSizeValue: pageSizeRef.current
        })
        return
      }

      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null
        void executeSearch({
          queryText: normalizePatientSearchQuery(queryInputRef.current),
          pageNumber: 1,
          pageSizeValue: pageSizeRef.current
        })
      }, patientSearchDebounceMs)
    },
    [applySearchDisplaySnapshot, clearDebounceTimer, executeSearch, pageSizeRef, queryInputRef]
  )

  useEffect(() => clearDebounceTimer, [clearDebounceTimer])

  useEffect(() => {
    if (initialLoadStartedRef.current) {
      return
    }

    initialLoadStartedRef.current = true
    void executeSearch({
      queryText: '',
      pageNumber: 1,
      pageSizeValue: pageSizeRef.current
    })
  }, [executeSearch, pageSizeRef])

  const emptyText = getPatientSearchEmptyText(state, failureMessage, appliedQuery)
  const statusText = getPatientSearchStatusText(
    state,
    failureMessage,
    total,
    page,
    pageSize,
    appliedQuery
  )

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
          value={queryInput}
          placeholder="Code, name, phone, DOB, age, sex, village, quarter"
          onChange={(event) => handleQueryInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              runImmediateSearch({
                queryText: queryInputRef.current,
                pageNumber: 1,
                pageSizeValue: pageSizeRef.current
              })
            }
          }}
        />
        <button
          type="button"
          className="button button-primary"
          disabled={state === 'LOADING'}
          onClick={() =>
            runImmediateSearch({
              queryText: queryInputRef.current,
              pageNumber: 1,
              pageSizeValue: pageSizeRef.current
            })
          }
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
            const nextPageSize = coercePatientSearchPageSize(value)
            setPageSize(nextPageSize)
            runImmediateSearch({
              queryText: queryInputRef.current,
              pageNumber: 1,
              pageSizeValue: nextPageSize
            })
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </div>
      <p className="patient-search-status" role="status" aria-live="polite">
        {statusText}
      </p>
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
          onClick={() =>
            runImmediateSearch({
              queryText: appliedQueryRef.current,
              pageNumber: page - 1,
              pageSizeValue: pageSizeRef.current
            })
          }
        >
          Previous
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={state === 'LOADING' || page * pageSize >= total}
          onClick={() =>
            runImmediateSearch({
              queryText: appliedQueryRef.current,
              pageNumber: page + 1,
              pageSizeValue: pageSizeRef.current
            })
          }
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
  onOpenPatient(patient: PublicPatientSummary): void
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
                onClick={() => onOpenPatient(candidate.patient)}
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
                aria-selected={patient.id === selectedPatientId ? 'true' : 'false'}
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
  api,
  patient,
  amendmentMode,
  amendmentBase,
  demographicDraft,
  amendmentReasonCode,
  amendmentReasonNote,
  amendmentValidationErrors,
  amendmentConflict,
  amendmentSaving,
  activeTab,
  userRole,
  demographicHistoryRevision,
  securityEpochRef,
  registerStateInvalidator,
  onPatientFailure,
  onSelectTab,
  onDraftChange,
  onReasonCodeChange,
  onReasonNoteChange,
  onEdit,
  onSave,
  onCancel,
  onReload,
  onReviewConflict,
  onRetryConflict,
  onDiscardConflict,
  onCancelConflict
}: {
  readonly api: HealthScreeningApi
  readonly patient: PublicPatientDetail | null
  readonly amendmentMode: boolean
  readonly amendmentBase: PublicPatientDetail | null
  readonly demographicDraft: PatientDemographicDraft | null
  readonly amendmentReasonCode: PatientDemographicAmendmentReasonSelection
  readonly amendmentReasonNote: string
  readonly amendmentValidationErrors: PatientDemographicAmendmentValidationErrors
  readonly amendmentConflict: PatientDemographicAmendmentConflictView | null
  readonly amendmentSaving: boolean
  readonly activeTab: PatientDetailTab
  readonly userRole: LocalUserRole
  readonly demographicHistoryRevision: number
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectTab(tab: PatientDetailTab): void
  onDraftChange(draft: PatientDemographicDraft): void
  onReasonCodeChange(reasonCode: PatientDemographicAmendmentReasonSelection): void
  onReasonNoteChange(reasonNote: string): void
  onEdit(): void
  onSave(): void
  onCancel(): void
  onReload(): void
  onReviewConflict(): void
  onRetryConflict(): void
  onDiscardConflict(): void
  onCancelConflict(): void
}): React.JSX.Element {
  const currentDetails =
    patient === null ? null : (
      <PatientCurrentDetailsPanel>
        {amendmentMode && amendmentBase !== null && demographicDraft !== null ? (
          <PatientDemographicAmendmentForm
            draft={demographicDraft}
            reasonCode={amendmentReasonCode}
            reasonNote={amendmentReasonNote}
            validationErrors={amendmentValidationErrors}
            conflict={amendmentConflict}
            pending={amendmentSaving}
            userRole={userRole}
            today={getCurrentLocalDate()}
            onDraftChange={onDraftChange}
            onReasonCodeChange={onReasonCodeChange}
            onReasonNoteChange={onReasonNoteChange}
            onSubmit={onSave}
            onCancel={onCancel}
            onReload={onReload}
            onReviewConflict={onReviewConflict}
            onRetryConflict={onRetryConflict}
            onDiscardConflict={onDiscardConflict}
            onCancelConflict={onCancelConflict}
          />
        ) : (
          <>
            <div className="patient-detail-header">
              <h2>{patient.patientCode}</h2>
              <button type="button" className="button button-secondary" onClick={onEdit}>
                Amend demographics
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
      </PatientCurrentDetailsPanel>
    )

  return (
    <PatientDetailTabs
      key={patient?.id ?? 'no-selected-patient'}
      api={api}
      patient={patient}
      activeTab={activeTab}
      currentDetails={currentDetails}
      demographicHistoryRevision={demographicHistoryRevision}
      securityEpochRef={securityEpochRef}
      registerStateInvalidator={registerStateInvalidator}
      onPatientFailure={onPatientFailure}
      onSelectTab={onSelectTab}
    />
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

function getPatientSearchEmptyText(
  state: LoadState,
  failureMessage: string | null,
  query: string
): string {
  switch (state) {
    case 'IDLE':
      return 'Loading patients.'
    case 'LOADING':
      return 'Searching patients.'
    case 'ERROR':
      return failureMessage ?? 'Patient search failed.'
    case 'EMPTY':
      return query.trim().length === 0
        ? 'No registered patients. Register New is available.'
        : 'No matching patients.'
    case 'READY':
      return 'No matching patients.'
  }
}

function getPatientSearchStatusText(
  state: LoadState,
  failureMessage: string | null,
  total: number,
  page: number,
  pageSize: PatientSearchPageSize,
  query: string
): string {
  switch (state) {
    case 'IDLE':
    case 'LOADING':
      return 'Loading patients.'
    case 'ERROR':
      return failureMessage ?? 'Patient search failed.'
    case 'EMPTY':
      return query.trim().length === 0
        ? 'No registered patients. Register New is available.'
        : 'No matching patients.'
    case 'READY': {
      const start = Math.min((page - 1) * pageSize + 1, total)
      const end = Math.min(page * pageSize, total)

      return `Showing ${start}-${end} of ${total} patients.`
    }
  }
}

function coercePatientSearchPageSize(value: number): PatientSearchPageSize {
  return value === 50 || value === 100 ? value : 25
}

function normalizePatientSearchQuery(query: string): string {
  return query.trim().length === 0 ? '' : query
}

function getPatientSearchTargetPatientId(
  items: readonly PublicPatientSummary[],
  selectedPatientId: string | null,
  preferredPatientId: string | null
): string | null {
  if (preferredPatientId !== null && items.some((patient) => patient.id === preferredPatientId)) {
    return preferredPatientId
  }

  if (selectedPatientId !== null && items.some((patient) => patient.id === selectedPatientId)) {
    return selectedPatientId
  }

  return items[0]?.id ?? null
}

function createPatientSearchDisplaySnapshot({
  items,
  total,
  page,
  pageSize,
  appliedQuery,
  state,
  failureMessage
}: PatientSearchDisplaySnapshot): PatientSearchDisplaySnapshot {
  return Object.freeze({
    items: Object.freeze([...items]),
    total,
    page,
    pageSize,
    appliedQuery,
    state,
    failureMessage
  })
}

function createPatientSearchResultSnapshot({
  requestId,
  securityEpoch,
  queryText,
  items,
  total,
  page,
  pageSize,
  targetPatientId,
  preferredPatientIdToConsume
}: {
  readonly requestId: number
  readonly securityEpoch: number
  readonly queryText: string
  readonly items: readonly PublicPatientSummary[]
  readonly total: number
  readonly page: number
  readonly pageSize: PatientSearchPageSize
  readonly targetPatientId: string | null
  readonly preferredPatientIdToConsume: string | null
}): PatientSearchResultSnapshot {
  return Object.freeze({
    requestId,
    securityEpoch,
    queryText,
    items: Object.freeze([...items]),
    total,
    page,
    pageSize,
    targetPatientId,
    preferredPatientIdToConsume
  })
}

function revealPatientInSearchItems(
  items: readonly PublicPatientSummary[],
  patient: PublicPatientSummary,
  pageSize: PatientSearchPageSize
): readonly PublicPatientSummary[] {
  if (items.some((item) => item.id === patient.id || item.patientCode === patient.patientCode)) {
    return items
  }

  return [patient, ...items.filter((item) => item.id !== patient.id)].slice(0, pageSize)
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

function useLatestRef<TValue>(value: TValue): MutableRefObject<TValue> {
  const ref = useRef(value)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref
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
