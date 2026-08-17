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
  PublicScreeningVitalsDraft,
  PublicScreeningSessionWorkspaceLocation,
  ScreeningEncounterIpcErrorCode,
  ScreeningEncounterStartSuccessData,
  ScreeningVitalsCompleteStepSuccessData,
  ScreeningVitalsGetDraftSuccessData,
  ScreeningVitalsSaveDraftSuccessData,
  ScreeningSessionEnsureCurrentSuccessData,
  ScreeningSessionErrorCode,
  ScreeningLifestyleWorkspace
} from '@shared/ipc'

import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import { LifestyleStep } from './lifestyle/LifestyleStep'
import {
  createAlcoholBaselineRequest,
  createAlcoholSaveDraftRequest,
  createInitialLifestyleDraftState,
  createLifestyleDraftStateFromWorkspace,
  collapseLifestylePanels,
  validateAlcoholBaseline,
  validateAlcoholWeeklyDraft,
  createTobaccoBaselineRequest as createTobaccoBaselineRequestFromForm,
  validateTobaccoBaseline,
  validateTobaccoWeeklyDraft,
  type LifestyleDraftState
} from './lifestyle/lifestyle-workspace-model'
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
  readonly vitalsDraft: VitalsDraft
  readonly lifestyleDraft: LifestyleDraftState
}

type WorkspaceMessage = {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
}

type ScreeningWorkspaceTab = 'PATIENTS' | 'NEW_SCREENING'
type ScreeningWorkflowStep = 'VITALS' | 'LIFESTYLE'
type VitalsMeasurementSite = 'RIGHT_ARM' | 'LEFT_ARM' | 'LEFT_LEG' | 'RIGHT_LEG'
type VitalsPosition = 'LYING' | 'STANDING' | 'SITTING'
type VitalsDraftLoadStatus = 'NOT_LOADED' | 'LOADING' | 'READY' | 'ERROR'
type VitalsDraftSaveStatus = 'IDLE' | 'SAVING' | 'SAVED' | 'ERROR'

interface VitalsReadingDraft {
  readonly id: string
  readonly systolic: string
  readonly diastolic: string
  readonly pulse: string
  readonly site: VitalsMeasurementSite | ''
  readonly position: VitalsPosition | ''
  readonly time: string
}

interface VitalsDraft {
  readonly activeStep: ScreeningWorkflowStep
  readonly loadStatus: VitalsDraftLoadStatus
  readonly saveStatus: VitalsDraftSaveStatus
  readonly draftId: string | null
  readonly expectedVersion: number | null
  readonly readings: readonly VitalsReadingDraft[]
  readonly weightKg: string
  readonly waist: string
  readonly notes: string
  readonly statusMessage: string | null
  readonly validationErrors: readonly VitalsValidationError[]
}

interface VitalsValidationError {
  readonly fieldId: string
  readonly message: string
}

const initialSessionState: CurrentSessionState = Object.freeze({ status: 'LOADING' })
const initialPatientSearchState: PatientSearchState = Object.freeze({ status: 'IDLE' })
const screeningSectionLabels = Object.freeze([
  'Vitals',
  'Lifestyle',
  'Food',
  'OTC',
  'Review'
] as const)
const vitalsSiteOptions = Object.freeze([
  { value: 'RIGHT_ARM', label: 'Right arm' },
  { value: 'LEFT_ARM', label: 'Left arm' },
  { value: 'LEFT_LEG', label: 'Left leg' },
  { value: 'RIGHT_LEG', label: 'Right leg' }
] as const)
const vitalsPositionOptions = Object.freeze([
  { value: 'LYING', label: 'Lying' },
  { value: 'STANDING', label: 'Standing' },
  { value: 'SITTING', label: 'Sitting' }
] as const)
let nextLocalVitalsReadingId = 1

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
  const vitalsLoadRequestRef = useRef<Map<string, number>>(new Map())
  const vitalsSaveRequestRef = useRef<Map<string, number>>(new Map())
  const lifestyleLoadRequestRef = useRef<Map<string, number>>(new Map())
  const lifestyleSaveRequestRef = useRef<Map<string, number>>(new Map())
  const lifestyleActiveEncounterRef = useRef<string | null>(null)
  const lifestyleContextEpochRef = useRef(0)
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
    vitalsLoadRequestRef.current.clear()
    vitalsSaveRequestRef.current.clear()
    lifestyleLoadRequestRef.current.clear()
    lifestyleSaveRequestRef.current.clear()
    lifestyleActiveEncounterRef.current = null
    lifestyleContextEpochRef.current += 1
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
    const vitalsLoadRequests = vitalsLoadRequestRef.current
    const vitalsSaveRequests = vitalsSaveRequestRef.current
    const lifestyleLoadRequests = lifestyleLoadRequestRef.current
    const lifestyleSaveRequests = lifestyleSaveRequestRef.current

    return () => {
      workspaceEpochRef.current += 1
      patientSearchRequestRef.current += 1
      vitalsLoadRequests.clear()
      vitalsSaveRequests.clear()
      lifestyleLoadRequests.clear()
      lifestyleSaveRequests.clear()
      lifestyleActiveEncounterRef.current = null
      lifestyleContextEpochRef.current += 1
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

            return [
              ...currentTabs,
              {
                patient,
                encounter,
                vitalsDraft: createInitialVitalsDraft(),
                lifestyleDraft: createInitialLifestyleDraftState()
              }
            ]
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

  const updateVitalsDraft = useCallback(
    (patientId: string, update: (draft: VitalsDraft) => VitalsDraft): void => {
      onOpenTabsChange((currentTabs) =>
        currentTabs.map((tab) =>
          tab.patient.id === patientId ? { ...tab, vitalsDraft: update(tab.vitalsDraft) } : tab
        )
      )
    },
    [onOpenTabsChange]
  )

  const updateLifestyleDraft = useCallback(
    (patientId: string, update: (draft: LifestyleDraftState) => LifestyleDraftState): void => {
      onOpenTabsChange((currentTabs) =>
        currentTabs.map((tab) =>
          tab.patient.id === patientId
            ? { ...tab, lifestyleDraft: update(tab.lifestyleDraft) }
            : tab
        )
      )
    },
    [onOpenTabsChange]
  )

  const loadVitalsDraft = useCallback(
    async (patientId: string, encounterId: string): Promise<void> => {
      const requestId = (vitalsLoadRequestRef.current.get(encounterId) ?? 0) + 1
      vitalsLoadRequestRef.current.set(encounterId, requestId)
      updateVitalsDraft(patientId, (draft) => ({
        ...draft,
        loadStatus: 'LOADING',
        saveStatus: 'IDLE',
        statusMessage: null,
        validationErrors: []
      }))

      try {
        const result = await api.screeningEncounters.vitals.getDraft({ encounterId })

        if (!mountedRef.current || vitalsLoadRequestRef.current.get(encounterId) !== requestId) {
          return
        }

        if (!result.ok) {
          updateVitalsDraft(patientId, (draft) => ({
            ...draft,
            loadStatus: 'ERROR',
            saveStatus: 'ERROR',
            statusMessage: getEncounterTransportFailureMessage(result.error.code)
          }))
          return
        }

        const data = result.data

        if (isVitalsDraftLoadedData(data)) {
          const persistedDraft = data.draft

          updateVitalsDraft(patientId, () =>
            persistedDraft === null
              ? createReadyEmptyVitalsDraft()
              : createVitalsDraftFromPersisted(persistedDraft)
          )
          return
        }

        updateVitalsDraft(patientId, (draft) => ({
          ...draft,
          loadStatus: 'ERROR',
          saveStatus: 'ERROR',
          statusMessage: getVitalsStatusMessage(data)
        }))
      } catch {
        if (mountedRef.current && vitalsLoadRequestRef.current.get(encounterId) === requestId) {
          updateVitalsDraft(patientId, (draft) => ({
            ...draft,
            loadStatus: 'ERROR',
            saveStatus: 'ERROR',
            statusMessage: 'Draft could not be loaded. Try again.'
          }))
        }
      }
    },
    [api, mountedRef, updateVitalsDraft]
  )

  const saveVitalsDraft = useCallback(
    async (
      patientId: string,
      encounterId: string,
      draft: VitalsDraft,
      mode: 'SAVE_DRAFT' | 'COMPLETE_STEP'
    ): Promise<void> => {
      if (draft.loadStatus !== 'READY' || draft.saveStatus === 'SAVING') {
        return
      }

      const validation = createVitalsSaveRequest(encounterId, draft, mode)

      if (validation.status !== 'VALID') {
        updateVitalsDraft(patientId, (currentDraft) => ({
          ...currentDraft,
          saveStatus: 'ERROR',
          statusMessage: validation.message,
          validationErrors: validation.errors
        }))
        focusMessage()
        return
      }

      const requestId = (vitalsSaveRequestRef.current.get(encounterId) ?? 0) + 1
      vitalsSaveRequestRef.current.set(encounterId, requestId)
      updateVitalsDraft(patientId, (currentDraft) => ({
        ...currentDraft,
        saveStatus: 'SAVING',
        statusMessage: mode === 'SAVE_DRAFT' ? 'Saving draft...' : 'Saving vitals...',
        validationErrors: []
      }))

      try {
        const result =
          mode === 'SAVE_DRAFT'
            ? await api.screeningEncounters.vitals.saveDraft(validation.request)
            : await api.screeningEncounters.vitals.completeStep(validation.request)

        if (!mountedRef.current || vitalsSaveRequestRef.current.get(encounterId) !== requestId) {
          return
        }

        if (!result.ok) {
          updateVitalsDraft(patientId, (currentDraft) => ({
            ...currentDraft,
            saveStatus: 'ERROR',
            statusMessage: getEncounterTransportFailureMessage(result.error.code)
          }))
          return
        }

        const data = result.data

        if (isVitalsDraftSavedData(data)) {
          const persistedDraft = data.draft

          updateVitalsDraft(patientId, () =>
            createVitalsDraftFromPersisted(persistedDraft, {
              activeStep: 'VITALS',
              saveStatus: 'SAVED',
              statusMessage: 'Draft saved'
            })
          )
          return
        }

        if (isVitalsStepCompletedData(data)) {
          const persistedDraft = data.draft

          updateVitalsDraft(patientId, () =>
            createVitalsDraftFromPersisted(persistedDraft, {
              activeStep: 'LIFESTYLE',
              saveStatus: 'SAVED',
              statusMessage: null
            })
          )
          return
        }

        updateVitalsDraft(patientId, (currentDraft) => ({
          ...currentDraft,
          saveStatus: 'ERROR',
          statusMessage: getVitalsStatusMessage(data)
        }))
      } catch {
        if (mountedRef.current && vitalsSaveRequestRef.current.get(encounterId) === requestId) {
          updateVitalsDraft(patientId, (currentDraft) => ({
            ...currentDraft,
            saveStatus: 'ERROR',
            statusMessage: 'Draft could not be saved. Try again.'
          }))
        }
      }
    },
    [api, focusMessage, mountedRef, updateVitalsDraft]
  )

  const loadLifestyleWorkspace = useCallback(
    async (patientId: string, encounterId: string): Promise<void> => {
      const contextEpoch = lifestyleContextEpochRef.current
      const requestId = (lifestyleLoadRequestRef.current.get(encounterId) ?? 0) + 1
      lifestyleLoadRequestRef.current.set(encounterId, requestId)
      updateLifestyleDraft(patientId, (draft) => ({
        ...draft,
        loadStatus: 'LOADING',
        saveStatus: 'IDLE',
        statusMessage: null,
        validationErrors: []
      }))

      try {
        const result = await api.screeningEncounters.lifestyle.getWorkspace({ encounterId })

        if (
          !mountedRef.current ||
          lifestyleLoadRequestRef.current.get(encounterId) !== requestId ||
          lifestyleActiveEncounterRef.current !== encounterId ||
          lifestyleContextEpochRef.current !== contextEpoch
        ) {
          return
        }

        if (!result.ok) {
          updateLifestyleDraft(patientId, (draft) => ({
            ...draft,
            loadStatus: 'ERROR',
            saveStatus: 'ERROR',
            statusMessage: getLifestyleFailureMessage(result.error.code)
          }))
          return
        }

        if (result.data.status === 'LOADED' && hasLifestyleWorkspace(result.data)) {
          const workspace = result.data.workspace
          updateLifestyleDraft(patientId, () => createLifestyleDraftStateFromWorkspace(workspace))
          return
        }

        updateLifestyleDraft(patientId, (draft) => ({
          ...draft,
          loadStatus: 'ERROR',
          saveStatus: 'ERROR',
          statusMessage: getLifestyleStatusMessage(result.data.status)
        }))
      } catch {
        if (
          mountedRef.current &&
          lifestyleLoadRequestRef.current.get(encounterId) === requestId &&
          lifestyleActiveEncounterRef.current === encounterId &&
          lifestyleContextEpochRef.current === contextEpoch
        ) {
          updateLifestyleDraft(patientId, (draft) => ({
            ...draft,
            loadStatus: 'ERROR',
            saveStatus: 'ERROR',
            statusMessage: 'Lifestyle could not be loaded. Try again.'
          }))
        }
      }
    },
    [api, mountedRef, updateLifestyleDraft]
  )

  const saveLifestyleBaseline = useCallback(
    async (patientId: string, encounterId: string, draft: LifestyleDraftState): Promise<void> => {
      if (draft.loadStatus !== 'READY' || draft.saveStatus === 'SAVING') return
      const contextEpoch = lifestyleContextEpochRef.current

      const validationErrors = validateAlcoholBaseline(draft.baselineForm)
      const request = createAlcoholBaselineRequest(encounterId, draft)
      if (validationErrors.length > 0 || request === null) {
        updateLifestyleDraft(patientId, (current) => ({
          ...current,
          saveStatus: 'ERROR',
          statusMessage: 'Baseline could not be saved. Check the highlighted fields.',
          validationErrors:
            validationErrors.length > 0
              ? validationErrors
              : [{ fieldId: 'baselineEverConsumed', message: 'Select an answer.' }]
        }))
        focusMessage()
        return
      }

      const requestId = (lifestyleSaveRequestRef.current.get(encounterId) ?? 0) + 1
      lifestyleSaveRequestRef.current.set(encounterId, requestId)
      updateLifestyleDraft(patientId, (current) => ({
        ...current,
        saveStatus: 'SAVING',
        statusMessage: 'Saving baseline...',
        validationErrors: []
      }))

      try {
        const result = await api.screeningEncounters.lifestyle.saveAlcoholBaseline(request)
        if (
          !mountedRef.current ||
          lifestyleSaveRequestRef.current.get(encounterId) !== requestId ||
          lifestyleActiveEncounterRef.current !== encounterId ||
          lifestyleContextEpochRef.current !== contextEpoch
        )
          return

        if (!result.ok) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: getLifestyleFailureMessage(result.error.code)
          }))
          return
        }

        if (result.data.status !== 'SAVED' || !hasLifestyleWorkspace(result.data)) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: getLifestyleStatusMessage(result.data.status)
          }))
          return
        }

        const workspace = result.data.workspace
        updateLifestyleDraft(patientId, (current) => {
          const next = createLifestyleDraftStateFromWorkspace(workspace, {
            saveStatus: 'SAVED',
            statusMessage: 'Baseline saved'
          })
          return {
            ...next,
            alcohol: current.alcohol,
            validationErrors: validateAlcoholWeeklyDraft(current.alcohol),
            tobacco: current.tobacco,
            tobaccoBaselineForm: current.tobaccoBaselineForm,
            tobaccoValidationErrors: current.tobaccoValidationErrors,
            dirty: current.dirty,
            baselineOpen: false
          }
        })
      } catch {
        if (
          mountedRef.current &&
          lifestyleSaveRequestRef.current.get(encounterId) === requestId &&
          lifestyleActiveEncounterRef.current === encounterId &&
          lifestyleContextEpochRef.current === contextEpoch
        ) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: 'Baseline could not be saved. Try again.'
          }))
        }
      }
    },
    [api, focusMessage, mountedRef, updateLifestyleDraft]
  )

  const saveLifestyleTobaccoBaseline = useCallback(
    async (patientId: string, encounterId: string, draft: LifestyleDraftState): Promise<void> => {
      if (draft.loadStatus !== 'READY' || draft.saveStatus === 'SAVING') return
      const contextEpoch = lifestyleContextEpochRef.current
      const validationErrors = validateTobaccoBaseline(draft.tobaccoBaselineForm)
      const request = createTobaccoBaselineRequestFromForm(
        encounterId,
        draft.workspace,
        draft.tobaccoBaselineForm
      )
      if (validationErrors.length > 0 || request === null) {
        updateLifestyleDraft(patientId, (current) => ({
          ...current,
          saveStatus: 'ERROR',
          statusMessage: 'Tobacco baseline could not be saved. Check the highlighted fields.',
          tobaccoValidationErrors:
            validationErrors.length > 0
              ? validationErrors
              : [{ fieldId: 'tobacco-baseline-ever-used', message: 'Select an answer.' }]
        }))
        focusMessage()
        return
      }
      const requestId = (lifestyleSaveRequestRef.current.get(encounterId) ?? 0) + 1
      lifestyleSaveRequestRef.current.set(encounterId, requestId)
      updateLifestyleDraft(patientId, (current) => ({
        ...current,
        saveStatus: 'SAVING',
        statusMessage: 'Saving Tobacco baseline...',
        tobaccoValidationErrors: []
      }))
      try {
        const result = await api.screeningEncounters.lifestyle.saveTobaccoBaseline(request)
        if (
          !mountedRef.current ||
          lifestyleSaveRequestRef.current.get(encounterId) !== requestId ||
          lifestyleActiveEncounterRef.current !== encounterId ||
          lifestyleContextEpochRef.current !== contextEpoch
        )
          return
        if (!result.ok) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: getLifestyleFailureMessage(result.error.code)
          }))
          return
        }
        if (result.data.status !== 'SAVED' || !hasLifestyleWorkspace(result.data)) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: getLifestyleStatusMessage(result.data.status)
          }))
          return
        }
        const workspace = result.data.workspace
        updateLifestyleDraft(patientId, (current) => ({
          ...createLifestyleDraftStateFromWorkspace(workspace, {
            saveStatus: 'SAVED',
            statusMessage: 'Tobacco baseline saved'
          }),
          alcohol: current.alcohol,
          validationErrors: validateAlcoholWeeklyDraft(current.alcohol),
          tobacco: current.tobacco,
          tobaccoValidationErrors: validateTobaccoWeeklyDraft(current.tobacco),
          dirty: current.dirty,
          tobaccoBaselineOpen: false,
          tobaccoExpanded: true
        }))
      } catch {
        if (
          mountedRef.current &&
          lifestyleSaveRequestRef.current.get(encounterId) === requestId &&
          lifestyleActiveEncounterRef.current === encounterId &&
          lifestyleContextEpochRef.current === contextEpoch
        ) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: 'Tobacco baseline could not be saved. Try again.'
          }))
        }
      }
    },
    [api, focusMessage, mountedRef, updateLifestyleDraft]
  )

  const saveLifestyleDraft = useCallback(
    async (patientId: string, encounterId: string, draft: LifestyleDraftState): Promise<void> => {
      if (draft.loadStatus !== 'READY' || draft.saveStatus === 'SAVING') return
      const contextEpoch = lifestyleContextEpochRef.current

      const validationErrors = validateAlcoholWeeklyDraft(draft.alcohol)
      const tobaccoValidationErrors = validateTobaccoWeeklyDraft(draft.tobacco)
      if (validationErrors.length > 0 || tobaccoValidationErrors.length > 0) {
        updateLifestyleDraft(patientId, (current) => ({
          ...current,
          saveStatus: 'ERROR',
          statusMessage: 'Draft could not be saved. Check the highlighted fields.',
          validationErrors,
          tobaccoValidationErrors
        }))
        focusMessage()
        return
      }

      const request = createAlcoholSaveDraftRequest(encounterId, draft)
      const requestId = (lifestyleSaveRequestRef.current.get(encounterId) ?? 0) + 1
      lifestyleSaveRequestRef.current.set(encounterId, requestId)
      updateLifestyleDraft(patientId, (current) => ({
        ...current,
        saveStatus: 'SAVING',
        statusMessage: 'Saving draft...',
        validationErrors: []
      }))

      try {
        const result = await api.screeningEncounters.lifestyle.saveDraft(request)
        if (
          !mountedRef.current ||
          lifestyleSaveRequestRef.current.get(encounterId) !== requestId ||
          lifestyleActiveEncounterRef.current !== encounterId ||
          lifestyleContextEpochRef.current !== contextEpoch
        )
          return

        if (!result.ok) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage:
              result.error.code === 'IPC_UNAVAILABLE'
                ? 'Draft could not be saved. Try again.'
                : getLifestyleFailureMessage(result.error.code)
          }))
          return
        }

        if (result.data.status !== 'SAVED' || !hasLifestyleWorkspace(result.data)) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: getLifestyleStatusMessage(result.data.status)
          }))
          return
        }

        if (result.data.workspace.encounterId !== encounterId) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: 'Draft could not be saved. Try again.'
          }))
          return
        }

        const workspace = result.data.workspace
        updateLifestyleDraft(patientId, () =>
          collapseLifestylePanels(
            createLifestyleDraftStateFromWorkspace(workspace, {
              saveStatus: 'SAVED',
              statusMessage: 'Draft saved'
            })
          )
        )
      } catch {
        if (
          mountedRef.current &&
          lifestyleSaveRequestRef.current.get(encounterId) === requestId &&
          lifestyleActiveEncounterRef.current === encounterId &&
          lifestyleContextEpochRef.current === contextEpoch
        ) {
          updateLifestyleDraft(patientId, (current) => ({
            ...current,
            saveStatus: 'ERROR',
            statusMessage: 'Draft could not be saved. Try again.'
          }))
        }
      }
    },
    [api, focusMessage, mountedRef, updateLifestyleDraft]
  )

  const retrySession = useCallback((): void => {
    void loadCurrentSession()
  }, [loadCurrentSession])

  const activeWorkspaceTab = getWorkspaceTabForCommand(commandId)
  const activeTab =
    openTabs.find((tab) => tab.patient.id === activePatientId) ?? openTabs[0] ?? null
  const activeEncounterId = activeTab?.encounter.id ?? null
  const hasReadySession = sessionState.status === 'READY'
  const workspaceHeading = activeWorkspaceTab === 'PATIENTS' ? 'Patients' : 'New Screening'

  useEffect(() => {
    if (
      activeWorkspaceTab !== 'NEW_SCREENING' ||
      activeTab === null ||
      activeTab.vitalsDraft.loadStatus !== 'NOT_LOADED'
    ) {
      return
    }

    void loadVitalsDraft(activeTab.patient.id, activeTab.encounter.id)
  }, [activeTab, activeWorkspaceTab, loadVitalsDraft])

  useEffect(() => {
    const encounterId = activeWorkspaceTab === 'NEW_SCREENING' ? activeEncounterId : null
    lifestyleContextEpochRef.current += 1
    lifestyleActiveEncounterRef.current = encounterId
  }, [activeEncounterId, activeWorkspaceTab])

  useEffect(() => {
    if (
      activeWorkspaceTab !== 'NEW_SCREENING' ||
      activeTab === null ||
      activeTab.vitalsDraft.activeStep !== 'LIFESTYLE' ||
      activeTab.lifestyleDraft.loadStatus !== 'NOT_LOADED'
    ) {
      return
    }

    void loadLifestyleWorkspace(activeTab.patient.id, activeTab.encounter.id)
  }, [activeTab, activeWorkspaceTab, loadLifestyleWorkspace])

  return (
    <section
      className={`screening-workspace${
        activeWorkspaceTab === 'NEW_SCREENING' ? ' screening-workspace-active-encounter' : ''
      }`}
      aria-labelledby={headingId}
    >
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
              onSaveVitalsDraft={saveVitalsDraft}
              onUpdateVitalsDraft={updateVitalsDraft}
              onLoadLifestyleWorkspace={loadLifestyleWorkspace}
              onSaveLifestyleBaseline={saveLifestyleBaseline}
              onSaveLifestyleTobaccoBaseline={saveLifestyleTobaccoBaseline}
              onSaveLifestyleDraft={saveLifestyleDraft}
              onUpdateLifestyleDraft={updateLifestyleDraft}
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
  onOpenPatients,
  onSaveVitalsDraft,
  onUpdateVitalsDraft,
  onLoadLifestyleWorkspace,
  onSaveLifestyleBaseline,
  onSaveLifestyleTobaccoBaseline,
  onSaveLifestyleDraft,
  onUpdateLifestyleDraft
}: {
  readonly activeTab: PatientScreeningTab | null
  readonly location: PublicScreeningSessionWorkspaceLocation
  readonly openTabs: readonly PatientScreeningTab[]
  readonly session: PublicCurrentScreeningSession
  onActivateTab(patientId: string): void
  onCloseTab(patientId: string): void
  onOpenPatients(): void
  onSaveVitalsDraft(
    patientId: string,
    encounterId: string,
    draft: VitalsDraft,
    mode: 'SAVE_DRAFT' | 'COMPLETE_STEP'
  ): void
  onUpdateVitalsDraft(patientId: string, update: (draft: VitalsDraft) => VitalsDraft): void
  onLoadLifestyleWorkspace(patientId: string, encounterId: string): void
  onSaveLifestyleBaseline(patientId: string, encounterId: string, draft: LifestyleDraftState): void
  onSaveLifestyleTobaccoBaseline(
    patientId: string,
    encounterId: string,
    draft: LifestyleDraftState
  ): void
  onSaveLifestyleDraft(patientId: string, encounterId: string, draft: LifestyleDraftState): void
  onUpdateLifestyleDraft(
    patientId: string,
    update: (draft: LifestyleDraftState) => LifestyleDraftState
  ): void
}): React.JSX.Element {
  return (
    <section
      className="screening-new-screening-workspace screening-new-screening-workspace-bounded"
      aria-label="New Screening workspace"
    >
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
        <div className="screening-split-workspace screening-split-workspace-bounded">
          <PatientContextPanel tab={activeTab} />
          <CurrentEncounterPanel
            location={location}
            session={session}
            tab={activeTab}
            onSaveVitalsDraft={(mode) =>
              onSaveVitalsDraft(
                activeTab.patient.id,
                activeTab.encounter.id,
                activeTab.vitalsDraft,
                mode
              )
            }
            onUpdateVitalsDraft={(update) => onUpdateVitalsDraft(activeTab.patient.id, update)}
            onLoadLifestyleWorkspace={() =>
              onLoadLifestyleWorkspace(activeTab.patient.id, activeTab.encounter.id)
            }
            onSaveLifestyleBaseline={() =>
              onSaveLifestyleBaseline(
                activeTab.patient.id,
                activeTab.encounter.id,
                activeTab.lifestyleDraft
              )
            }
            onSaveLifestyleTobaccoBaseline={() =>
              onSaveLifestyleTobaccoBaseline(
                activeTab.patient.id,
                activeTab.encounter.id,
                activeTab.lifestyleDraft
              )
            }
            onSaveLifestyleDraft={() =>
              onSaveLifestyleDraft(
                activeTab.patient.id,
                activeTab.encounter.id,
                activeTab.lifestyleDraft
              )
            }
            onUpdateLifestyleDraft={(update) =>
              onUpdateLifestyleDraft(activeTab.patient.id, update)
            }
          />
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
            {formatPatientContextDateOfBirth(tab.patient)} • {formatPatientSex(tab.patient.sex)}
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
  tab,
  onSaveVitalsDraft,
  onUpdateVitalsDraft,
  onLoadLifestyleWorkspace,
  onSaveLifestyleBaseline,
  onSaveLifestyleTobaccoBaseline,
  onSaveLifestyleDraft,
  onUpdateLifestyleDraft
}: {
  readonly location: PublicScreeningSessionWorkspaceLocation
  readonly session: PublicCurrentScreeningSession
  readonly tab: PatientScreeningTab
  onSaveVitalsDraft(mode: 'SAVE_DRAFT' | 'COMPLETE_STEP'): void
  onUpdateVitalsDraft(update: (draft: VitalsDraft) => VitalsDraft): void
  onLoadLifestyleWorkspace(): void
  onSaveLifestyleBaseline(): void
  onSaveLifestyleTobaccoBaseline(): void
  onSaveLifestyleDraft(): void
  onUpdateLifestyleDraft(update: (draft: LifestyleDraftState) => LifestyleDraftState): void
}): React.JSX.Element {
  const displayName = formatPatientName(tab.patient)
  const activeStepIndex = getActiveStepIndex(tab.vitalsDraft.activeStep)

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
          <li key={label} data-active={index === activeStepIndex ? 'true' : 'false'}>
            <span>{index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      {tab.vitalsDraft.activeStep === 'VITALS' ? (
        <VitalsStep
          draft={tab.vitalsDraft}
          encounterStatus={tab.encounter.status}
          onRetryLoad={() =>
            onUpdateVitalsDraft((draft) => ({ ...draft, loadStatus: 'NOT_LOADED' }))
          }
          onSaveDraft={() => onSaveVitalsDraft('SAVE_DRAFT')}
          onContinue={() => onSaveVitalsDraft('COMPLETE_STEP')}
          onUpdateDraft={onUpdateVitalsDraft}
        />
      ) : (
        <LifestyleStep
          encounterId={tab.encounter.id}
          encounterStatus={tab.encounter.status}
          state={tab.lifestyleDraft}
          onBackToVitals={() => {
            onUpdateVitalsDraft((draft) => ({ ...draft, activeStep: 'VITALS' }))
          }}
          onRetryLoad={onLoadLifestyleWorkspace}
          onReload={() => {
            onUpdateLifestyleDraft((draft) => ({
              ...createInitialLifestyleDraftState(),
              loadStatus: 'NOT_LOADED',
              workspace: draft.workspace,
              baselineForm: draft.baselineForm,
              alcohol: draft.alcohol,
              tobaccoBaselineForm: draft.tobaccoBaselineForm,
              tobacco: draft.tobacco,
              tobaccoValidationErrors: draft.tobaccoValidationErrors,
              dirty: draft.dirty
            }))
            onLoadLifestyleWorkspace()
          }}
          onUpdate={onUpdateLifestyleDraft}
          onSaveBaseline={onSaveLifestyleBaseline}
          onSaveTobaccoBaseline={onSaveLifestyleTobaccoBaseline}
          onSaveDraft={onSaveLifestyleDraft}
        />
      )}
    </section>
  )
}

function VitalsStep({
  draft,
  encounterStatus,
  onContinue,
  onRetryLoad,
  onSaveDraft,
  onUpdateDraft
}: {
  readonly draft: VitalsDraft
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  onContinue(): void
  onRetryLoad(): void
  onSaveDraft(): void
  onUpdateDraft(update: (draft: VitalsDraft) => VitalsDraft): void
}): React.JSX.Element {
  const controlsDisabled = draft.loadStatus !== 'READY' || draft.saveStatus === 'SAVING'

  if (draft.loadStatus === 'LOADING' || draft.loadStatus === 'NOT_LOADED') {
    return (
      <section className="screening-current-step" aria-labelledby="screening-vitals-step-title">
        <div className="screening-current-step-header">
          <h3 id="screening-vitals-step-title">Vitals</h3>
          <span>{formatEncounterStatus(encounterStatus)}</span>
        </div>
        <div className="screening-empty-state screening-compact-empty">Loading vitals.</div>
      </section>
    )
  }

  if (draft.loadStatus === 'ERROR') {
    return (
      <section className="screening-current-step" aria-labelledby="screening-vitals-step-title">
        <div className="screening-current-step-header">
          <h3 id="screening-vitals-step-title">Vitals</h3>
          <span>{formatEncounterStatus(encounterStatus)}</span>
        </div>
        <div className="screening-empty-state screening-compact-empty" role="alert">
          <p>{draft.statusMessage ?? 'Draft could not be loaded. Try again.'}</p>
          <button className="button button-secondary" type="button" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="screening-current-step" aria-labelledby="screening-vitals-step-title">
      <div className="screening-current-step-header">
        <h3 id="screening-vitals-step-title">Vitals</h3>
        <span>{formatEncounterStatus(encounterStatus)}</span>
      </div>

      <section className="screening-vitals-entry" aria-label="Vitals collection">
        <h4>Blood pressure readings</h4>
        <div className="screening-vitals-table-scroll">
          <table className="screening-vitals-table">
            <thead>
              <tr>
                <th scope="col">Reading</th>
                <th scope="col">Systolic</th>
                <th scope="col">Diastolic</th>
                <th scope="col">Pulse</th>
                <th scope="col">Site</th>
                <th scope="col">Position</th>
                <th scope="col">Time</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {draft.readings.map((reading, index) => (
                <tr key={reading.id}>
                  <th scope="row">{index + 1}</th>
                  <td>
                    <input
                      aria-label={`Reading ${index + 1} systolic`}
                      inputMode="numeric"
                      type="number"
                      min="0"
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'systolic')}
                      value={reading.systolic}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            systolic: value
                          })
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Reading ${index + 1} diastolic`}
                      inputMode="numeric"
                      type="number"
                      min="0"
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'diastolic')}
                      value={reading.diastolic}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            diastolic: value
                          })
                        )
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Reading ${index + 1} pulse`}
                      inputMode="numeric"
                      type="number"
                      min="0"
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'pulse')}
                      value={reading.pulse}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            pulse: value
                          })
                        )
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label={`Reading ${index + 1} site`}
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'site')}
                      value={reading.site}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value as VitalsReadingDraft['site']

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            site: value
                          })
                        )
                      }}
                    >
                      <option value="">Select</option>
                      {vitalsSiteOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label={`Reading ${index + 1} position`}
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'position')}
                      value={reading.position}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value as VitalsReadingDraft['position']

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            position: value
                          })
                        )
                      }}
                    >
                      <option value="">Select</option>
                      {vitalsPositionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Reading ${index + 1} time`}
                      type="time"
                      aria-invalid={hasVitalsFieldError(draft, reading.id, 'time')}
                      value={reading.time}
                      disabled={controlsDisabled}
                      onChange={(event) => {
                        const value = event.currentTarget.value

                        onUpdateDraft((currentDraft) =>
                          updateVitalsReading(currentDraft, reading.id, {
                            time: value
                          })
                        )
                      }}
                    />
                  </td>
                  <td>
                    {index === 0 ? (
                      <span aria-label="Reading 1 cannot be removed">—</span>
                    ) : (
                      <button
                        className="button button-secondary screening-reading-remove"
                        type="button"
                        disabled={controlsDisabled}
                        onClick={() => {
                          if (
                            shouldConfirmVitalsReadingRemoval(reading) &&
                            !window.confirm('Remove this reading?')
                          ) {
                            return
                          }

                          onUpdateDraft((currentDraft) =>
                            removeVitalsReading(currentDraft, reading.id)
                          )
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="screening-vitals-table-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={controlsDisabled}
            onClick={() => {
              onUpdateDraft(addVitalsReading)
            }}
          >
            Add reading
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={controlsDisabled}
            onClick={onSaveDraft}
          >
            {draft.saveStatus === 'SAVING' ? 'Saving draft...' : 'Save draft'}
          </button>
        </div>

        {draft.validationErrors.length > 0 ? (
          <div className="screening-vitals-validation" role="alert">
            {draft.statusMessage ?? 'Complete or remove the highlighted readings.'}
            <ul className="screening-vitals-validation-list">
              {draft.validationErrors.map((error) => (
                <li key={`${error.fieldId}:${error.message}`}>{error.message}</li>
              ))}
            </ul>
          </div>
        ) : draft.statusMessage !== null ? (
          <div
            className={`screening-vitals-validation${
              draft.saveStatus === 'ERROR' ? ' screening-vitals-validation-error' : ''
            }`}
            role={draft.saveStatus === 'ERROR' ? 'alert' : 'status'}
          >
            {draft.statusMessage}
          </div>
        ) : null}

        <div className="screening-vitals-fields" aria-label="Additional vitals fields">
          <label>
            <span>Weight (kg)</span>
            <input
              aria-label="Weight in kilograms"
              type="number"
              min="0"
              aria-invalid={hasOptionalVitalsFieldError(draft, 'weight')}
              value={draft.weightKg}
              disabled={controlsDisabled}
              onChange={(event) => {
                const value = event.currentTarget.value

                onUpdateDraft((currentDraft) => ({
                  ...currentDraft,
                  weightKg: value,
                  saveStatus: 'IDLE',
                  statusMessage: null,
                  validationErrors: currentDraft.validationErrors.filter(
                    (error) => error.fieldId !== 'weight'
                  )
                }))
              }}
            />
          </label>
          <label>
            <span>Waist (optional)</span>
            <input
              aria-label="Waist optional"
              type="number"
              min="0"
              aria-invalid={hasOptionalVitalsFieldError(draft, 'waist')}
              value={draft.waist}
              disabled={controlsDisabled}
              onChange={(event) => {
                const value = event.currentTarget.value

                onUpdateDraft((currentDraft) => ({
                  ...currentDraft,
                  waist: value,
                  saveStatus: 'IDLE',
                  statusMessage: null,
                  validationErrors: currentDraft.validationErrors.filter(
                    (error) => error.fieldId !== 'waist'
                  )
                }))
              }}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              aria-label="Vitals notes"
              value={draft.notes}
              disabled={controlsDisabled}
              onChange={(event) => {
                const value = event.currentTarget.value

                onUpdateDraft((currentDraft) => ({
                  ...currentDraft,
                  notes: value,
                  saveStatus: 'IDLE',
                  statusMessage: null
                }))
              }}
            />
          </label>
        </div>
      </section>

      <div className="screening-guidance-note" role="note">
        <strong>Screening guidance—not a diagnosis.</strong>
      </div>

      <div className="screening-encounter-actions">
        <button className="button button-secondary" type="button" disabled>
          Previous
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={controlsDisabled}
          onClick={onContinue}
        >
          {draft.saveStatus === 'SAVING' ? 'Saving vitals...' : 'Continue to Lifestyle'}
        </button>
      </div>
    </section>
  )
}

function createInitialVitalsDraft(): VitalsDraft {
  return {
    ...createReadyEmptyVitalsDraft(),
    loadStatus: 'NOT_LOADED'
  }
}

function createReadyEmptyVitalsDraft(): VitalsDraft {
  return {
    activeStep: 'VITALS',
    loadStatus: 'READY',
    saveStatus: 'IDLE',
    draftId: null,
    expectedVersion: null,
    readings: [createVitalsReadingDraft(1)],
    weightKg: '',
    waist: '',
    notes: '',
    statusMessage: null,
    validationErrors: []
  }
}

function createVitalsDraftFromPersisted(
  persisted: PublicScreeningVitalsDraft,
  options: Partial<
    Pick<VitalsDraft, 'activeStep' | 'saveStatus' | 'statusMessage' | 'validationErrors'>
  > = {}
): VitalsDraft {
  const readings: readonly VitalsReadingDraft[] =
    persisted.readings.length === 0
      ? [createVitalsReadingDraft(1)]
      : persisted.readings
          .slice()
          .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
          .map((reading) => ({
            id: reading.id,
            systolic: formatOptionalNumericInput(reading.systolic),
            diastolic: formatOptionalNumericInput(reading.diastolic),
            pulse: formatOptionalNumericInput(reading.pulse),
            site: (reading.measurementSite ?? '') as VitalsReadingDraft['site'],
            position: (reading.patientPosition ?? '') as VitalsReadingDraft['position'],
            time: reading.measurementTime ?? ''
          }))

  return {
    activeStep:
      options.activeStep ?? (persisted.status === 'VITALS_COMPLETE' ? 'LIFESTYLE' : 'VITALS'),
    loadStatus: 'READY',
    saveStatus: options.saveStatus ?? 'IDLE',
    draftId: persisted.id,
    expectedVersion: persisted.rowVersion,
    readings,
    weightKg: formatOptionalNumericInput(persisted.weightKg),
    waist: formatOptionalNumericInput(persisted.waistCm),
    notes: persisted.notes ?? '',
    statusMessage: options.statusMessage ?? null,
    validationErrors: options.validationErrors ?? []
  }
}

function createVitalsReadingDraft(readingNumber: number): VitalsReadingDraft {
  return {
    id: `local-reading-${nextLocalVitalsReadingId++}-${readingNumber}`,
    systolic: '',
    diastolic: '',
    pulse: '',
    site: '',
    position: '',
    time: ''
  }
}

function addVitalsReading(draft: VitalsDraft): VitalsDraft {
  return {
    ...draft,
    readings: [...draft.readings, createVitalsReadingDraft(draft.readings.length + 1)],
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: []
  }
}

function removeVitalsReading(draft: VitalsDraft, readingId: string): VitalsDraft {
  const readingIndex = draft.readings.findIndex((reading) => reading.id === readingId)

  if (readingIndex <= 0) {
    return draft
  }

  return {
    ...draft,
    readings: draft.readings.filter((reading) => reading.id !== readingId),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: []
  }
}

function updateVitalsReading(
  draft: VitalsDraft,
  readingId: string,
  update: Partial<Omit<VitalsReadingDraft, 'id'>>
): VitalsDraft {
  return {
    ...draft,
    readings: draft.readings.map((reading) =>
      reading.id === readingId ? { ...reading, ...update } : reading
    ),
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: draft.validationErrors.filter(
      (error) => !error.fieldId.startsWith(`${readingId}:`)
    )
  }
}

function createVitalsSaveRequest(
  encounterId: string,
  draft: VitalsDraft,
  mode: 'SAVE_DRAFT' | 'COMPLETE_STEP'
):
  | {
      readonly status: 'VALID'
      readonly request: Parameters<
        HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']
      >[0]
    }
  | {
      readonly status: 'INVALID'
      readonly message: string
      readonly errors: readonly VitalsValidationError[]
    } {
  const errors: VitalsValidationError[] = []
  const readings = draft.readings.map((reading, index) => {
    const readingNumber = index + 1
    const parsed = parseVitalsReadingForRequest(reading, readingNumber, mode, errors)

    return {
      id: isUuid(reading.id) ? reading.id : null,
      sequenceNumber: readingNumber,
      ...parsed
    }
  })
  const weightKg = parseOptionalDecimal(draft.weightKg, 'weight', 'Weight', errors)
  const waistCm = parseOptionalDecimal(draft.waist, 'waist', 'Waist', errors)

  if (mode === 'COMPLETE_STEP' && !hasOneCompleteReading(readings)) {
    errors.push({
      fieldId: 'readings',
      message: 'Complete Reading 1 before continuing.'
    })
  }

  if (errors.length > 0) {
    return {
      status: 'INVALID',
      message:
        mode === 'COMPLETE_STEP'
          ? 'Complete or remove the highlighted readings.'
          : 'Draft could not be saved. Check the highlighted fields.',
      errors
    }
  }

  return {
    status: 'VALID',
    request: {
      encounterId,
      expectedVersion: draft.expectedVersion,
      readings,
      weightKg,
      waistCm,
      notes: draft.notes.trim().length === 0 ? null : draft.notes
    }
  }
}

function parseVitalsReadingForRequest(
  reading: VitalsReadingDraft,
  readingNumber: number,
  mode: 'SAVE_DRAFT' | 'COMPLETE_STEP',
  errors: VitalsValidationError[]
): Omit<
  Parameters<
    HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']
  >[0]['readings'][number],
  'id' | 'sequenceNumber'
> {
  const parsed = {
    systolic: parseOptionalInteger(
      reading.systolic,
      `${reading.id}:systolic`,
      `Reading ${readingNumber} systolic`,
      errors
    ),
    diastolic: parseOptionalInteger(
      reading.diastolic,
      `${reading.id}:diastolic`,
      `Reading ${readingNumber} diastolic`,
      errors
    ),
    pulse: parseOptionalInteger(
      reading.pulse,
      `${reading.id}:pulse`,
      `Reading ${readingNumber} pulse`,
      errors
    ),
    measurementSite: reading.site === '' ? null : (reading.site as VitalsMeasurementSite),
    patientPosition: reading.position === '' ? null : (reading.position as VitalsPosition),
    measurementTime: reading.time.trim().length === 0 ? null : reading.time
  }

  if (
    parsed.measurementTime !== null &&
    !/^([01]\d|2[0-3]):[0-5]\d$/u.test(parsed.measurementTime)
  ) {
    errors.push({
      fieldId: `${reading.id}:time`,
      message: `Reading ${readingNumber} time must be a valid time.`
    })
  }

  if (mode === 'COMPLETE_STEP') {
    const missingFields: Array<keyof typeof parsed> = []

    if (parsed.systolic === null) missingFields.push('systolic')
    if (parsed.diastolic === null) missingFields.push('diastolic')
    if (parsed.pulse === null) missingFields.push('pulse')
    if (parsed.measurementSite === null) missingFields.push('measurementSite')
    if (parsed.patientPosition === null) missingFields.push('patientPosition')
    if (parsed.measurementTime === null) missingFields.push('measurementTime')

    for (const field of missingFields) {
      errors.push({
        fieldId: `${reading.id}:${toVitalsFieldName(field)}`,
        message: `Reading ${readingNumber} ${toVitalsFieldLabel(field)} is required.`
      })
    }
  }

  return parsed
}

function parseOptionalInteger(
  value: string,
  fieldId: string,
  label: string,
  errors: VitalsValidationError[]
): number | null {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (!/^[1-9]\d*$/u.test(trimmed)) {
    errors.push({ fieldId, message: `${label} must be a positive whole number.` })
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    errors.push({ fieldId, message: `${label} must be a positive whole number.` })
    return null
  }

  return parsed
}

function parseOptionalDecimal(
  value: string,
  fieldId: string,
  label: string,
  errors: VitalsValidationError[]
): number | null {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (!/^(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)$/u.test(trimmed)) {
    errors.push({ fieldId, message: `${label} must be a positive number.` })
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push({ fieldId, message: `${label} must be a positive number.` })
    return null
  }

  return parsed
}

function hasOneCompleteReading(
  readings: Parameters<
    HealthScreeningApi['screeningEncounters']['vitals']['saveDraft']
  >[0]['readings']
): boolean {
  return readings.some(
    (reading) =>
      reading.systolic !== null &&
      reading.diastolic !== null &&
      reading.pulse !== null &&
      reading.measurementSite !== null &&
      reading.patientPosition !== null &&
      reading.measurementTime !== null
  )
}

function hasVitalsFieldError(draft: VitalsDraft, readingId: string, fieldName: string): boolean {
  return draft.validationErrors.some((error) => error.fieldId === `${readingId}:${fieldName}`)
}

function hasOptionalVitalsFieldError(draft: VitalsDraft, fieldName: string): boolean {
  return draft.validationErrors.some((error) => error.fieldId === fieldName)
}

function shouldConfirmVitalsReadingRemoval(reading: VitalsReadingDraft): boolean {
  return isUuid(reading.id) || !isVitalsReadingDraftEmpty(reading)
}

function isVitalsReadingDraftEmpty(reading: VitalsReadingDraft): boolean {
  return (
    reading.systolic.trim().length === 0 &&
    reading.diastolic.trim().length === 0 &&
    reading.pulse.trim().length === 0 &&
    reading.site === '' &&
    reading.position === '' &&
    reading.time.trim().length === 0
  )
}

function toVitalsFieldName(field: string): string {
  switch (field) {
    case 'measurementSite':
      return 'site'
    case 'patientPosition':
      return 'position'
    case 'measurementTime':
      return 'time'
    default:
      return field
  }
}

function toVitalsFieldLabel(field: string): string {
  switch (field) {
    case 'measurementSite':
      return 'site'
    case 'patientPosition':
      return 'position'
    case 'measurementTime':
      return 'time'
    default:
      return field
  }
}

function formatOptionalNumericInput(value: number | null): string {
  return value === null ? '' : String(value)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function getActiveStepIndex(step: ScreeningWorkflowStep): number {
  return step === 'LIFESTYLE' ? 1 : 0
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

function getVitalsStatusMessage(
  data:
    | ScreeningVitalsGetDraftSuccessData
    | ScreeningVitalsSaveDraftSuccessData
    | ScreeningVitalsCompleteStepSuccessData
): string {
  switch (data.status) {
    case 'LOADED':
      return 'Draft could not be loaded. Try again.'
    case 'SAVED':
    case 'COMPLETED':
      return 'Draft could not be saved. Try again.'
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for Screening.'
    case 'VALIDATION_FAILED':
      return 'Draft could not be saved. Check the highlighted fields.'
    case 'VERSION_CONFLICT':
      return 'Draft changed elsewhere. Reload and try again.'
    case 'ENCOUNTER_NOT_FOUND':
    case 'ENCOUNTER_NOT_EDITABLE':
      return 'This screening encounter is unavailable.'
    case 'LOCATION_NOT_CONFIGURED':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
    case 'SESSION_NOT_FOUND':
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_CURRENT':
    case 'UNAVAILABLE':
      return 'Draft could not be saved. Try again.'
  }
}

function getLifestyleFailureMessage(
  code: 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
): string {
  switch (code) {
    case 'IPC_FORBIDDEN':
      return 'This window is not allowed to open Lifestyle.'
    case 'IPC_UNAVAILABLE':
    case 'INTERNAL_ERROR':
      return 'Lifestyle is unavailable.'
  }
}

function getLifestyleStatusMessage(status: string): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for Lifestyle.'
    case 'VALIDATION_FAILED':
      return 'Lifestyle data could not be saved. Check the highlighted fields.'
    case 'LOCATION_NOT_CONFIGURED':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
      return 'The screening location is unavailable.'
    case 'ENCOUNTER_NOT_FOUND':
    case 'ENCOUNTER_NOT_EDITABLE':
      return 'This screening encounter is unavailable.'
    case 'SESSION_NOT_FOUND':
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_CURRENT':
      return 'The screening session is unavailable.'
    case 'VERSION_CONFLICT':
      return 'Draft changed elsewhere. Reload and try again.'
    case 'UNAVAILABLE':
      return 'Lifestyle is unavailable.'
    default:
      return 'Lifestyle could not be loaded. Try again.'
  }
}

function hasLifestyleWorkspace(data: {
  readonly status: string
  readonly workspace?: ScreeningLifestyleWorkspace
}): data is { readonly status: string; readonly workspace: ScreeningLifestyleWorkspace } {
  return data.workspace !== undefined
}

function isVitalsDraftLoadedData(
  data: ScreeningVitalsGetDraftSuccessData
): data is Extract<ScreeningVitalsGetDraftSuccessData, { readonly status: 'LOADED' }> {
  return data.status === 'LOADED'
}

function isVitalsDraftSavedData(
  data: ScreeningVitalsSaveDraftSuccessData | ScreeningVitalsCompleteStepSuccessData
): data is Extract<ScreeningVitalsSaveDraftSuccessData, { readonly status: 'SAVED' }> {
  return data.status === 'SAVED'
}

function isVitalsStepCompletedData(
  data: ScreeningVitalsSaveDraftSuccessData | ScreeningVitalsCompleteStepSuccessData
): data is Extract<ScreeningVitalsCompleteStepSuccessData, { readonly status: 'COMPLETED' }> {
  return data.status === 'COMPLETED'
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

function formatPatientContextDateOfBirth(patient: PublicPatientSummary): string {
  if (patient.dateOfBirth === null) {
    return '—'
  }

  const [year, month, day] = patient.dateOfBirth.split('-')

  return `${month}/${day}/${year}`
}

function formatPatientTabLabel(patient: PublicPatientSummary): string {
  return formatPatientName(patient)
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
