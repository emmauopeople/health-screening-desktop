import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactNode } from 'react'

import type { HealthScreeningApi, PatientErrorCode, PublicPatientDetail } from '@shared/ipc'

import { PatientAcknowledgmentHistoryPanel } from './PatientAcknowledgmentHistoryPanel'
import { PatientDemographicHistoryPanel } from './PatientDemographicHistoryPanel'
import { PatientIdentifiersPanel } from './PatientIdentifiersPanel'
import type {
  AcknowledgmentHistoryItem,
  DemographicHistoryItem,
  HistoryLoadState,
  PatientHistoryPageSize
} from './patient-history-state'

export type PatientDetailTab =
  'CURRENT_DETAILS' | 'DEMOGRAPHIC_HISTORY' | 'ACKNOWLEDGMENT_HISTORY' | 'IDENTIFIERS'

type PatientStateInvalidator = () => void
type RegisterPatientStateInvalidator = (invalidator: PatientStateInvalidator) => () => void

interface PatientDetailTabsProps {
  readonly api: HealthScreeningApi
  readonly patient: PublicPatientDetail | null
  readonly activeTab: PatientDetailTab
  readonly currentDetails: ReactNode
  readonly demographicHistoryRevision: number
  readonly acknowledgmentHistoryRevision: number
  readonly securityEpochRef: MutableRefObject<number>
  registerStateInvalidator: RegisterPatientStateInvalidator
  onPatientFailure(code: PatientErrorCode, message: string): boolean
  onSelectTab(tab: PatientDetailTab): void
}

const transportFailureMessage = 'The desktop service is unavailable.'
const defaultHistoryPageSize = 25

const patientDetailTabs = Object.freeze([
  {
    id: 'CURRENT_DETAILS',
    label: 'Current Details',
    tabId: 'patient-detail-tab-current-details',
    panelId: 'patient-detail-panel-current-details'
  },
  {
    id: 'DEMOGRAPHIC_HISTORY',
    label: 'Demographic History',
    tabId: 'patient-detail-tab-demographic-history',
    panelId: 'patient-detail-panel-demographic-history'
  },
  {
    id: 'ACKNOWLEDGMENT_HISTORY',
    label: 'Acknowledgment History',
    tabId: 'patient-detail-tab-acknowledgment-history',
    panelId: 'patient-detail-panel-acknowledgment-history'
  },
  {
    id: 'IDENTIFIERS',
    label: 'Identifiers',
    tabId: 'patient-detail-tab-identifiers',
    panelId: 'patient-detail-panel-identifiers'
  }
] as const satisfies readonly {
  readonly id: PatientDetailTab
  readonly label: string
  readonly tabId: string
  readonly panelId: string
}[])

export function PatientDetailTabs({
  api,
  patient,
  activeTab,
  currentDetails,
  demographicHistoryRevision,
  acknowledgmentHistoryRevision,
  securityEpochRef,
  registerStateInvalidator,
  onPatientFailure,
  onSelectTab
}: PatientDetailTabsProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const demographicRequestRef = useRef(0)
  const acknowledgmentRequestRef = useRef(0)
  const tabButtonRefs = useRef(new Map<PatientDetailTab, HTMLButtonElement>())
  const [focusedTab, setFocusedTab] = useState<PatientDetailTab>(activeTab)
  const [demographicHistoryState, setDemographicHistoryState] = useState<
    HistoryLoadState<DemographicHistoryItem>
  >({ status: 'IDLE' })
  const [acknowledgmentHistoryState, setAcknowledgmentHistoryState] = useState<
    HistoryLoadState<AcknowledgmentHistoryItem>
  >({ status: 'IDLE' })
  const demographicHistoryStateRef = useLatestRef(demographicHistoryState)
  const acknowledgmentHistoryStateRef = useLatestRef(acknowledgmentHistoryState)
  const demographicHistoryRevisionRef = useRef(demographicHistoryRevision)
  const acknowledgmentHistoryRevisionRef = useRef(acknowledgmentHistoryRevision)
  const patientId = patient?.id ?? null

  const invalidateHistoryState = useCallback((): void => {
    demographicRequestRef.current += 1
    acknowledgmentRequestRef.current += 1
    setDemographicHistoryState({ status: 'IDLE' })
    setAcknowledgmentHistoryState({ status: 'IDLE' })
  }, [])

  useEffect(
    () => registerStateInvalidator(invalidateHistoryState),
    [invalidateHistoryState, registerStateInvalidator]
  )

  useEffect(() => {
    return () => {
      demographicRequestRef.current += 1
      acknowledgmentRequestRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (demographicHistoryRevisionRef.current === demographicHistoryRevision) {
      return
    }

    demographicHistoryRevisionRef.current = demographicHistoryRevision
    demographicRequestRef.current += 1
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setDemographicHistoryState({ status: 'IDLE' })
      }
    })

    return () => {
      cancelled = true
    }
  }, [demographicHistoryRevision])

  useEffect(() => {
    if (acknowledgmentHistoryRevisionRef.current === acknowledgmentHistoryRevision) {
      return
    }

    acknowledgmentHistoryRevisionRef.current = acknowledgmentHistoryRevision
    acknowledgmentRequestRef.current += 1
    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setAcknowledgmentHistoryState({ status: 'IDLE' })
      }
    })

    return () => {
      cancelled = true
    }
  }, [acknowledgmentHistoryRevision])

  const loadDemographicHistory = useCallback(
    async (page: number, pageSize: PatientHistoryPageSize): Promise<void> => {
      if (patientId === null) {
        return
      }

      const currentState = demographicHistoryStateRef.current

      if (
        currentState.status === 'LOADING' &&
        currentState.page === page &&
        currentState.pageSize === pageSize
      ) {
        return
      }

      const requestId = demographicRequestRef.current + 1
      demographicRequestRef.current = requestId
      const startedSecurityEpoch = securityEpochRef.current
      const startedPatientId = patientId
      setDemographicHistoryState({ status: 'LOADING', page, pageSize })

      try {
        const result = await api.patient.listDemographicAmendmentHistory({
          patientId: startedPatientId,
          page,
          pageSize
        })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          demographicRequestRef.current !== requestId ||
          startedPatientId !== patientId
        ) {
          return
        }

        if (!result.ok) {
          if (onPatientFailure(result.error.code, result.error.message)) {
            return
          }

          setDemographicHistoryState({
            status: 'ERROR',
            message: result.error.message,
            page,
            pageSize
          })
          return
        }

        setDemographicHistoryState(
          result.data.items.length === 0
            ? { status: 'EMPTY', page: result.data.page, pageSize: result.data.pageSize }
            : {
                status: 'READY',
                items: result.data.items,
                page: result.data.page,
                pageSize: result.data.pageSize,
                total: result.data.total
              }
        )
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          demographicRequestRef.current === requestId &&
          startedPatientId === patientId
        ) {
          setDemographicHistoryState({
            status: 'ERROR',
            message: transportFailureMessage,
            page,
            pageSize
          })
        }
      }
    },
    [api, demographicHistoryStateRef, mountedRef, onPatientFailure, patientId, securityEpochRef]
  )

  const loadAcknowledgmentHistory = useCallback(
    async (page: number, pageSize: PatientHistoryPageSize): Promise<void> => {
      if (patientId === null) {
        return
      }

      const currentState = acknowledgmentHistoryStateRef.current

      if (
        currentState.status === 'LOADING' &&
        currentState.page === page &&
        currentState.pageSize === pageSize
      ) {
        return
      }

      const requestId = acknowledgmentRequestRef.current + 1
      acknowledgmentRequestRef.current = requestId
      const startedSecurityEpoch = securityEpochRef.current
      const startedPatientId = patientId
      setAcknowledgmentHistoryState({ status: 'LOADING', page, pageSize })

      try {
        const result = await api.patient.listAcknowledgmentHistory({
          patientId: startedPatientId,
          page,
          pageSize
        })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          acknowledgmentRequestRef.current !== requestId ||
          startedPatientId !== patientId
        ) {
          return
        }

        if (!result.ok) {
          if (onPatientFailure(result.error.code, result.error.message)) {
            return
          }

          setAcknowledgmentHistoryState({
            status: 'ERROR',
            message: result.error.message,
            page,
            pageSize
          })
          return
        }

        setAcknowledgmentHistoryState(
          result.data.items.length === 0
            ? { status: 'EMPTY', page: result.data.page, pageSize: result.data.pageSize }
            : {
                status: 'READY',
                items: result.data.items,
                page: result.data.page,
                pageSize: result.data.pageSize,
                total: result.data.total
              }
        )
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          acknowledgmentRequestRef.current === requestId &&
          startedPatientId === patientId
        ) {
          setAcknowledgmentHistoryState({
            status: 'ERROR',
            message: transportFailureMessage,
            page,
            pageSize
          })
        }
      }
    },
    [acknowledgmentHistoryStateRef, api, mountedRef, onPatientFailure, patientId, securityEpochRef]
  )

  useEffect(() => {
    let cancelled = false

    if (
      patientId !== null &&
      activeTab === 'DEMOGRAPHIC_HISTORY' &&
      demographicHistoryState.status === 'IDLE'
    ) {
      queueMicrotask(() => {
        if (!cancelled) {
          void loadDemographicHistory(1, defaultHistoryPageSize)
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [activeTab, demographicHistoryState.status, loadDemographicHistory, patientId])

  useEffect(() => {
    let cancelled = false

    if (
      patientId !== null &&
      activeTab === 'ACKNOWLEDGMENT_HISTORY' &&
      acknowledgmentHistoryState.status === 'IDLE'
    ) {
      queueMicrotask(() => {
        if (!cancelled) {
          void loadAcknowledgmentHistory(1, defaultHistoryPageSize)
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [acknowledgmentHistoryState.status, activeTab, loadAcknowledgmentHistory, patientId])

  if (patient === null) {
    return (
      <aside className="patient-detail-pane" aria-label="Selected patient">
        <p className="patient-empty">Select a patient to view or update details.</p>
      </aside>
    )
  }

  const activeDefinition = getTabDefinition(activeTab)

  return (
    <aside className="patient-detail-pane" aria-label="Selected patient">
      <div className="patient-detail-tabs" role="tablist" aria-label="Selected patient details">
        {patientDetailTabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) {
                tabButtonRefs.current.delete(tab.id)
                return
              }

              tabButtonRefs.current.set(tab.id, element)
            }}
            id={tab.tabId}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id ? 'true' : 'false'}
            aria-controls={tab.panelId}
            tabIndex={focusedTab === tab.id ? 0 : -1}
            className="patient-detail-tab"
            onClick={() => {
              setFocusedTab(tab.id)
              onSelectTab(tab.id)
            }}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id, setFocusedTab, tabButtonRefs)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={activeDefinition.panelId}
        role="tabpanel"
        aria-labelledby={activeDefinition.tabId}
        className="patient-detail-tab-panel"
      >
        {activeTab === 'CURRENT_DETAILS' ? currentDetails : null}
        {activeTab === 'DEMOGRAPHIC_HISTORY' ? (
          <PatientDemographicHistoryPanel
            state={demographicHistoryState}
            onRetry={() => {
              const state = demographicHistoryStateRef.current
              void loadDemographicHistory(getHistoryPage(state), getHistoryPageSize(state))
            }}
            onPageChange={(page) => {
              const state = demographicHistoryStateRef.current
              void loadDemographicHistory(page, getHistoryPageSize(state))
            }}
            onPageSizeChange={(pageSize) => {
              void loadDemographicHistory(1, pageSize)
            }}
          />
        ) : null}
        {activeTab === 'ACKNOWLEDGMENT_HISTORY' ? (
          <PatientAcknowledgmentHistoryPanel
            state={acknowledgmentHistoryState}
            onRetry={() => {
              const state = acknowledgmentHistoryStateRef.current
              void loadAcknowledgmentHistory(getHistoryPage(state), getHistoryPageSize(state))
            }}
            onPageChange={(page) => {
              const state = acknowledgmentHistoryStateRef.current
              void loadAcknowledgmentHistory(page, getHistoryPageSize(state))
            }}
            onPageSizeChange={(pageSize) => {
              void loadAcknowledgmentHistory(1, pageSize)
            }}
          />
        ) : null}
        {activeTab === 'IDENTIFIERS' ? <PatientIdentifiersPanel patient={patient} /> : null}
      </div>
    </aside>
  )
}

function handleTabKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  tab: PatientDetailTab,
  setFocusedTab: (tab: PatientDetailTab) => void,
  tabButtonRefs: MutableRefObject<Map<PatientDetailTab, HTMLButtonElement>>
): void {
  const currentIndex = patientDetailTabs.findIndex((definition) => definition.id === tab)
  let nextTab: PatientDetailTab | null = null

  switch (event.key) {
    case 'ArrowRight':
      nextTab = patientDetailTabs[(currentIndex + 1) % patientDetailTabs.length]?.id ?? null
      break
    case 'ArrowLeft':
      nextTab =
        patientDetailTabs[(currentIndex - 1 + patientDetailTabs.length) % patientDetailTabs.length]
          ?.id ?? null
      break
    case 'Home':
      nextTab = patientDetailTabs[0]?.id ?? null
      break
    case 'End':
      nextTab = patientDetailTabs[patientDetailTabs.length - 1]?.id ?? null
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      event.currentTarget.click()
      return
    default:
      return
  }

  event.preventDefault()
  if (nextTab === null) {
    return
  }

  setFocusedTab(nextTab)
  tabButtonRefs.current.get(nextTab)?.focus({ preventScroll: true })
}

function getTabDefinition(tab: PatientDetailTab): (typeof patientDetailTabs)[number] {
  return patientDetailTabs.find((definition) => definition.id === tab) ?? patientDetailTabs[0]
}

function getHistoryPage<TItem>(state: HistoryLoadState<TItem>): number {
  return state.status === 'IDLE' ? 1 : state.page
}

function getHistoryPageSize<TItem>(state: HistoryLoadState<TItem>): PatientHistoryPageSize {
  return state.status === 'IDLE' ? defaultHistoryPageSize : state.pageSize
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
