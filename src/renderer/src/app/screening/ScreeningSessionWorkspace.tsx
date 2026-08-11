import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject
} from 'react'

import type {
  HealthScreeningApi,
  LocalUserRole,
  PublicScreeningSession,
  PublicScreeningSessionWorkspaceLocation,
  ScreeningSessionEnsureCurrentSuccessData,
  ScreeningSessionErrorCode,
  ScreeningSessionListRequest,
  ScreeningSessionPageSize,
  ScreeningSessionStatus
} from '@shared/ipc'

import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import {
  createSessionIdentityText,
  formatProtocolVersionLabel,
  formatScreeningSessionStatus,
  formatScreeningSessionTimestamp,
  getScreeningSessionFailureMessage,
  isProtectedScreeningSessionFailure,
  resolveLocationName,
  screeningSessionPageSizes,
  validateOptionalLifecycleText,
  validateRequiredLifecycleText,
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

type WorkspaceContextState =
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly deploymentLocalDate: string
      readonly activeLocations: readonly PublicScreeningSessionWorkspaceLocation[]
    }
  | { readonly status: 'ERROR'; readonly message: string }

type SessionListState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING' }
  | {
      readonly status: 'READY'
      readonly items: readonly PublicScreeningSession[]
      readonly page: number
      readonly pageSize: ScreeningSessionPageSize
      readonly total: number
    }
  | {
      readonly status: 'EMPTY'
      readonly page: number
      readonly pageSize: ScreeningSessionPageSize
    }
  | { readonly status: 'ERROR'; readonly message: string }

type WorkspaceMessage = {
  readonly tone: 'STATUS' | 'ALERT'
  readonly text: string
}

type DialogState =
  | {
      readonly kind: 'CLOSE'
      readonly session: PublicScreeningSession
      readonly reason: string
      readonly error: string | null
    }
  | {
      readonly kind: 'REOPEN'
      readonly session: PublicScreeningSession
      readonly reason: string
      readonly error: string | null
    }
  | null

interface SessionListFilters {
  readonly status: ScreeningSessionStatus | null
  readonly dateFrom: string | null
  readonly dateTo: string | null
  readonly page: number
  readonly pageSize: ScreeningSessionPageSize
}

const protectedEmptyContextState: WorkspaceContextState = Object.freeze({ status: 'LOADING' })
const emptyListState: SessionListState = Object.freeze({ status: 'IDLE' })
const initialFilters: SessionListFilters = Object.freeze({
  status: null,
  dateFrom: null,
  dateTo: null,
  page: 1,
  pageSize: 25
})

export function ScreeningSessionWorkspace({
  api,
  commandId,
  headingId,
  headingRef,
  userRole,
  onScreeningSessionAuthenticationFailure,
  registerNavigationGuard
}: ScreeningSessionWorkspaceProps): React.JSX.Element {
  const mountedRef = useMountedRef()
  const securityEpochRef = useRef(0)
  const contextRequestRef = useRef(0)
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const mutationRequestRef = useRef(0)
  const mutationPendingRef = useRef(false)
  const pendingListKeyRef = useRef<string | null>(null)
  const messageRef = useRef<HTMLDivElement | null>(null)
  const dialogErrorRef = useRef<HTMLDivElement | null>(null)
  const activeLocationIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  const selectedSessionRef = useRef<PublicScreeningSession | null>(null)
  const [contextState, setContextState] = useState<WorkspaceContextState>(
    protectedEmptyContextState
  )
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [selectedSession, setSelectedSession] = useState<PublicScreeningSession | null>(null)
  const [filters, setFilters] = useState<SessionListFilters>(initialFilters)
  const [listState, setListState] = useState<SessionListState>(emptyListState)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [message, setMessage] = useState<WorkspaceMessage | null>(null)
  const [operationPending, setOperationPending] = useState(false)
  const canReopen = userRole === 'LOCAL_ADMIN' || userRole === 'NURSE'

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  useEffect(() => {
    activeLocationIdRef.current = activeLocationId
  }, [activeLocationId])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    selectedSessionRef.current = selectedSession
  }, [selectedSession])

  const focusMessage = useCallback((): void => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        messageRef.current?.focus({ preventScroll: true })
      }
    })
  }, [mountedRef])

  const setStatusMessage = useCallback(
    (text: string, tone: WorkspaceMessage['tone'] = 'STATUS'): void => {
      setMessage({ text, tone })
      focusMessage()
    },
    [focusMessage]
  )

  const clearProtectedWorkspaceState = useCallback((): void => {
    securityEpochRef.current += 1
    contextRequestRef.current += 1
    listRequestRef.current += 1
    detailRequestRef.current += 1
    mutationRequestRef.current += 1
    mutationPendingRef.current = false
    pendingListKeyRef.current = null
    setContextState(protectedEmptyContextState)
    setActiveLocationId(null)
    setActiveSessionId(null)
    setSelectedSessionId(null)
    setSelectedSession(null)
    setFilters(initialFilters)
    setListState(emptyListState)
    setDialog(null)
    setOperationPending(false)
  }, [])

  const handleFailure = useCallback(
    (code: ScreeningSessionErrorCode): boolean => {
      const failureMessage = getScreeningSessionFailureMessage(code)

      if (isProtectedScreeningSessionFailure(code)) {
        clearProtectedWorkspaceState()
        setMessage({ text: failureMessage, tone: 'ALERT' })
        focusMessage()
        onScreeningSessionAuthenticationFailure(code)
        return true
      }

      setStatusMessage(failureMessage, 'ALERT')
      return false
    },
    [
      clearProtectedWorkspaceState,
      focusMessage,
      onScreeningSessionAuthenticationFailure,
      setStatusMessage
    ]
  )

  const clearSessionReference = useCallback((sessionId: string | null = null): void => {
    setSelectedSessionId((currentSelectedSessionId) =>
      sessionId === null || currentSelectedSessionId === sessionId ? null : currentSelectedSessionId
    )
    setSelectedSession((currentSelectedSession) =>
      sessionId === null || currentSelectedSession?.id === sessionId ? null : currentSelectedSession
    )
    setActiveSessionId((currentActiveSessionId) =>
      sessionId === null || currentActiveSessionId === sessionId ? null : currentActiveSessionId
    )
  }, [])

  const applyAuthoritativeSession = useCallback(
    (session: PublicScreeningSession, options: { readonly activate?: boolean } = {}): void => {
      if (!isSessionInspectableInWorkspace(session, contextState, activeLocationId)) {
        clearSessionReference(session.id)
        return
      }

      setSelectedSessionId(session.id)
      setSelectedSession(session)
      setActiveSessionId((currentActiveSessionId) => {
        const canBeActive = isSessionActiveInWorkspace(session, contextState, activeLocationId)

        if (canBeActive && (options.activate === true || currentActiveSessionId === session.id)) {
          return session.id
        }

        return currentActiveSessionId === session.id || options.activate === true
          ? null
          : currentActiveSessionId
      })
    },
    [activeLocationId, clearSessionReference, contextState]
  )

  const applyEnsureCurrentResult = useCallback(
    (data: ScreeningSessionEnsureCurrentSuccessData): void => {
      if (data.status === 'RESOLVED' || data.status === 'CREATED') {
        const session: PublicScreeningSession = data.session
        const nextFilters: SessionListFilters = {
          status: null,
          dateFrom: session.sessionDate,
          dateTo: session.sessionDate,
          page: 1,
          pageSize: initialFilters.pageSize
        }

        activeLocationIdRef.current = data.location.id
        activeSessionIdRef.current = session.id
        selectedSessionIdRef.current = session.id
        selectedSessionRef.current = session
        pendingListKeyRef.current = null

        setContextState({
          status: 'READY',
          deploymentLocalDate: session.sessionDate,
          activeLocations: [data.location]
        })
        setActiveLocationId(data.location.id)
        setActiveSessionId(session.id)
        setSelectedSessionId(session.id)
        setSelectedSession(session)
        setFilters(nextFilters)
        setListState({
          status: 'READY',
          items: [session],
          page: nextFilters.page,
          pageSize: nextFilters.pageSize,
          total: 1
        })

        if (data.status === 'CREATED') {
          setStatusMessage("Today's screening session is open.")
        }

        return
      }

      const message = getEnsureCurrentStatusMessage(data.status)

      if (data.status === 'AUTHENTICATION_REQUIRED' || data.status === 'FORBIDDEN') {
        clearProtectedWorkspaceState()
        setContextState({ status: 'ERROR', message })
        setMessage({ text: message, tone: 'ALERT' })
        focusMessage()
        onScreeningSessionAuthenticationFailure(
          data.status === 'AUTHENTICATION_REQUIRED'
            ? 'AUTH_UNAUTHENTICATED'
            : 'AUTHORIZATION_FAILED'
        )
        return
      }

      activeLocationIdRef.current = null
      activeSessionIdRef.current = null
      selectedSessionIdRef.current = null
      selectedSessionRef.current = null
      pendingListKeyRef.current = null
      setContextState({ status: 'ERROR', message })
      setActiveLocationId(null)
      setActiveSessionId(null)
      setSelectedSessionId(null)
      setSelectedSession(null)
      setFilters(initialFilters)
      setListState(emptyListState)
      setStatusMessage(message, 'ALERT')
    },
    [
      clearProtectedWorkspaceState,
      focusMessage,
      onScreeningSessionAuthenticationFailure,
      setStatusMessage
    ]
  )

  const getAuthoritativeSessionForListReconciliation = useCallback(
    async (
      sessionId: string,
      startedSecurityEpoch: number,
      listRequestId: number
    ): Promise<PublicScreeningSession | null | 'STALE'> => {
      try {
        const result = await api.screeningSessions.getById({ id: sessionId })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          listRequestRef.current !== listRequestId
        ) {
          return 'STALE'
        }

        if (!result.ok) {
          handleFailure(result.error.code)
          return null
        }

        return result.data.status === 'FOUND' ? result.data.session : null
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          listRequestRef.current === listRequestId
        ) {
          setStatusMessage(getScreeningSessionFailureMessage('IPC_UNAVAILABLE'), 'ALERT')
        }

        return null
      }
    },
    [api, handleFailure, mountedRef, setStatusMessage]
  )

  const loadContext = useCallback(async (): Promise<void> => {
    const requestId = contextRequestRef.current + 1
    const startedSecurityEpoch = securityEpochRef.current
    contextRequestRef.current = requestId
    setContextState({ status: 'LOADING' })
    setMessage(null)

    try {
      const result = await api.screeningSessions.ensureCurrent()

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        contextRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        handleFailure(result.error.code)
        setContextState({
          status: 'ERROR',
          message: getScreeningSessionFailureMessage(result.error.code)
        })
        return
      }

      applyEnsureCurrentResult(result.data)
    } catch {
      if (
        mountedRef.current &&
        securityEpochRef.current === startedSecurityEpoch &&
        contextRequestRef.current === requestId
      ) {
        const unavailableMessage = getScreeningSessionFailureMessage('IPC_UNAVAILABLE')
        setContextState({ status: 'ERROR', message: unavailableMessage })
        setStatusMessage(unavailableMessage, 'ALERT')
      }
    }
  }, [api, applyEnsureCurrentResult, handleFailure, mountedRef, setStatusMessage])

  const loadSessionById = useCallback(
    async (sessionId: string): Promise<void> => {
      const requestId = detailRequestRef.current + 1
      const startedSecurityEpoch = securityEpochRef.current
      detailRequestRef.current = requestId

      try {
        const result = await api.screeningSessions.getById({ id: sessionId })

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          detailRequestRef.current !== requestId
        ) {
          return
        }

        if (!result.ok) {
          handleFailure(result.error.code)
          return
        }

        if (result.data.status === 'FOUND') {
          applyAuthoritativeSession(result.data.session)
          return
        }

        clearSessionReference(sessionId)
        setStatusMessage('The selected screening session is no longer available.', 'ALERT')
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          detailRequestRef.current === requestId
        ) {
          setStatusMessage(getScreeningSessionFailureMessage('IPC_UNAVAILABLE'), 'ALERT')
        }
      }
    },
    [
      api,
      applyAuthoritativeSession,
      clearSessionReference,
      handleFailure,
      mountedRef,
      setStatusMessage
    ]
  )

  const loadSessions = useCallback(
    async (
      nextFilters: SessionListFilters = filters,
      options: { readonly selectMatchingToday?: boolean; readonly locationId?: string } = {}
    ): Promise<void> => {
      if (contextState.status !== 'READY') {
        setListState(emptyListState)
        return
      }

      const locationId = options.locationId ?? activeLocationId

      if (locationId === null) {
        setListState(emptyListState)
        return
      }

      const request: ScreeningSessionListRequest = {
        locationId,
        status: nextFilters.status,
        dateFrom: nextFilters.dateFrom,
        dateTo: nextFilters.dateTo,
        page: nextFilters.page,
        pageSize: nextFilters.pageSize
      }
      const requestKey = JSON.stringify(request)

      if (pendingListKeyRef.current === requestKey) {
        return
      }

      const requestId = listRequestRef.current + 1
      const startedSecurityEpoch = securityEpochRef.current
      listRequestRef.current = requestId
      pendingListKeyRef.current = requestKey
      setListState({ status: 'LOADING' })

      try {
        const result = await api.screeningSessions.list(request)

        if (
          !mountedRef.current ||
          securityEpochRef.current !== startedSecurityEpoch ||
          listRequestRef.current !== requestId
        ) {
          return
        }

        pendingListKeyRef.current = null

        if (!result.ok) {
          handleFailure(result.error.code)
          setListState({
            status: 'ERROR',
            message: getScreeningSessionFailureMessage(result.error.code)
          })
          return
        }

        const listedSessions = result.data.items

        if (listedSessions.length === 0) {
          setListState({
            status: 'EMPTY',
            page: result.data.page,
            pageSize: result.data.pageSize
          })
        } else {
          setListState({
            status: 'READY',
            items: listedSessions,
            page: result.data.page,
            pageSize: result.data.pageSize,
            total: result.data.total
          })
        }

        const matchingToday = listedSessions.find(
          (session) =>
            session.locationId === locationId &&
            session.sessionDate === contextState.deploymentLocalDate
        )
        const selectedSessionId = selectedSessionIdRef.current
        const activeSessionId = activeSessionIdRef.current
        let activeSessionReconciledThroughSelectedSession = false

        if (options.selectMatchingToday && matchingToday !== undefined) {
          applyAuthoritativeSession(matchingToday, { activate: matchingToday.status === 'OPEN' })
        } else if (selectedSessionId !== null) {
          const listedSelectedSession = listedSessions.find(
            (session) => session.id === selectedSessionId
          )

          if (listedSelectedSession !== undefined) {
            applyAuthoritativeSession(listedSelectedSession, {
              activate: activeSessionIdRef.current === selectedSessionId
            })
            activeSessionReconciledThroughSelectedSession = activeSessionId === selectedSessionId
          } else {
            const revalidatedSelectedSession = await getAuthoritativeSessionForListReconciliation(
              selectedSessionId,
              startedSecurityEpoch,
              requestId
            )

            if (revalidatedSelectedSession === 'STALE') {
              return
            }

            if (
              revalidatedSelectedSession === null ||
              !isSessionInspectableInWorkspace(revalidatedSelectedSession, contextState, locationId)
            ) {
              clearSessionReference(selectedSessionId)
            } else {
              applyAuthoritativeSession(revalidatedSelectedSession, {
                activate: activeSessionIdRef.current === selectedSessionId
              })
            }

            activeSessionReconciledThroughSelectedSession = activeSessionId === selectedSessionId
          }
        } else if (matchingToday !== undefined) {
          applyAuthoritativeSession(matchingToday)
        }

        if (activeSessionId !== null && !activeSessionReconciledThroughSelectedSession) {
          const listedActiveSession = listedSessions.find(
            (session) => session.id === activeSessionId
          )

          if (listedActiveSession !== undefined) {
            if (!isSessionActiveInWorkspace(listedActiveSession, contextState, locationId)) {
              setActiveSessionId(null)
            }
          } else {
            const revalidatedActiveSession = await getAuthoritativeSessionForListReconciliation(
              activeSessionId,
              startedSecurityEpoch,
              requestId
            )

            if (revalidatedActiveSession === 'STALE') {
              return
            }

            if (
              revalidatedActiveSession === null ||
              !isSessionActiveInWorkspace(revalidatedActiveSession, contextState, locationId)
            ) {
              setActiveSessionId(null)
            }
          }
        }
      } catch {
        if (
          mountedRef.current &&
          securityEpochRef.current === startedSecurityEpoch &&
          listRequestRef.current === requestId
        ) {
          pendingListKeyRef.current = null
          setListState({
            status: 'ERROR',
            message: getScreeningSessionFailureMessage('IPC_UNAVAILABLE')
          })
          setStatusMessage(getScreeningSessionFailureMessage('IPC_UNAVAILABLE'), 'ALERT')
        }
      } finally {
        if (pendingListKeyRef.current === requestKey) {
          pendingListKeyRef.current = null
        }
      }
    },
    [
      activeLocationId,
      api,
      applyAuthoritativeSession,
      clearSessionReference,
      contextState,
      filters,
      getAuthoritativeSessionForListReconciliation,
      handleFailure,
      mountedRef,
      setStatusMessage
    ]
  )

  useEffect(() => {
    queueMicrotask(() => {
      if (mountedRef.current) {
        void loadContext()
      }
    })
  }, [loadContext, mountedRef])

  useEffect(() => {
    const guard: WorkspaceNavigationGuard = () => true
    registerNavigationGuard(guard)

    return () => {
      registerNavigationGuard(null)
    }
  }, [registerNavigationGuard])

  useEffect(() => {
    queueMicrotask(() => {
      if (!mountedRef.current) {
        return
      }

      if (contextState.status !== 'READY' || activeLocationId === null) {
        setListState(emptyListState)
        return
      }

      void loadSessions(filters, { selectMatchingToday: true })
    })
  }, [activeLocationId, contextState.status, filters, loadSessions, mountedRef])

  useEffect(() => {
    if (dialog !== null && dialog.error !== null) {
      dialogErrorRef.current?.focus({ preventScroll: true })
    }
  }, [dialog])

  const activeLocations = contextState.status === 'READY' ? contextState.activeLocations : []
  const deploymentLocalDate =
    contextState.status === 'READY' ? contextState.deploymentLocalDate : 'Not available'
  const activeLocation =
    activeLocationId === null
      ? null
      : (activeLocations.find((location) => location.id === activeLocationId) ?? null)
  const selectedSessionLocationName =
    selectedSession === null
      ? 'No location selected'
      : resolveLocationName(selectedSession.locationId, activeLocations)
  const selectedSessionIsTodayForActiveLocation =
    selectedSession !== null &&
    activeLocationId !== null &&
    selectedSession.locationId === activeLocationId &&
    selectedSession.sessionDate === deploymentLocalDate
  const selectedSessionCanBeActive =
    selectedSession !== null &&
    isSessionActiveInWorkspace(selectedSession, contextState, activeLocationId)
  const listedTodaySession =
    activeLocationId !== null && listState.status === 'READY'
      ? (listState.items.find(
          (session) =>
            session.locationId === activeLocationId && session.sessionDate === deploymentLocalDate
        ) ?? null)
      : null
  const todaySessionForActiveLocation = selectedSessionIsTodayForActiveLocation
    ? selectedSession
    : listedTodaySession
  const totalPages =
    listState.status === 'READY' ? Math.max(1, Math.ceil(listState.total / listState.pageSize)) : 1
  const displayedRange =
    listState.status === 'READY'
      ? `${(listState.page - 1) * listState.pageSize + 1}-${Math.min(
          listState.page * listState.pageSize,
          listState.total
        )} of ${listState.total}`
      : null

  async function submitClose(): Promise<void> {
    if (dialog?.kind !== 'CLOSE' || mutationPendingRef.current) {
      return
    }

    const reasonResult = validateOptionalLifecycleText(dialog.reason, 'Close reason')

    if (reasonResult.status === 'INVALID') {
      setDialog({ ...dialog, error: reasonResult.message })
      return
    }

    const requestId = mutationRequestRef.current + 1
    const startedSecurityEpoch = securityEpochRef.current
    mutationRequestRef.current = requestId
    mutationPendingRef.current = true
    setOperationPending(true)
    setDialog({ ...dialog, error: null })

    try {
      const result = await api.screeningSessions.close({
        id: dialog.session.id,
        expectedRowVersion: dialog.session.rowVersion,
        reason: reasonResult.value
      })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        mutationRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        handleFailure(result.error.code)
        return
      }

      switch (result.data.status) {
        case 'CLOSED':
          setDialog(null)
          applyAuthoritativeSession(result.data.session)
          setStatusMessage('Screening session closed.')
          await loadSessions(filters)
          break
        case 'SESSION_VERSION_CONFLICT':
          setDialog(null)
          applyAuthoritativeSession(result.data.session)
          setStatusMessage(
            'This screening session changed. Review the latest status before trying again.',
            'ALERT'
          )
          await loadSessions(filters)
          break
        case 'ALREADY_CLOSED':
          setDialog(null)
          applyAuthoritativeSession(result.data.session)
          setStatusMessage('This screening session is already closed.')
          await loadSessions(filters)
          break
        case 'NOT_FOUND':
          setDialog(null)
          setSelectedSessionId(null)
          setSelectedSession(null)
          setActiveSessionId(null)
          setStatusMessage('The screening session is no longer available.', 'ALERT')
          await loadSessions(filters)
          break
      }
    } catch {
      if (mountedRef.current && securityEpochRef.current === startedSecurityEpoch) {
        setStatusMessage(getScreeningSessionFailureMessage('IPC_UNAVAILABLE'), 'ALERT')
      }
    } finally {
      if (mutationRequestRef.current === requestId) {
        mutationPendingRef.current = false
        setOperationPending(false)
      }
    }
  }

  async function submitReopen(): Promise<void> {
    if (dialog?.kind !== 'REOPEN' || mutationPendingRef.current) {
      return
    }

    if (!canReopen) {
      setDialog({
        ...dialog,
        error: 'Only nurses and local administrators can reopen a closed session.'
      })
      return
    }

    const reasonResult = validateRequiredLifecycleText(dialog.reason, 'Reopen reason')

    if (reasonResult.status === 'INVALID') {
      setDialog({ ...dialog, error: reasonResult.message })
      return
    }

    const requestId = mutationRequestRef.current + 1
    const startedSecurityEpoch = securityEpochRef.current
    mutationRequestRef.current = requestId
    mutationPendingRef.current = true
    setOperationPending(true)
    setDialog({ ...dialog, error: null })

    try {
      const result = await api.screeningSessions.reopen({
        id: dialog.session.id,
        expectedRowVersion: dialog.session.rowVersion,
        reason: reasonResult.value ?? dialog.reason
      })

      if (
        !mountedRef.current ||
        securityEpochRef.current !== startedSecurityEpoch ||
        mutationRequestRef.current !== requestId
      ) {
        return
      }

      if (!result.ok) {
        handleFailure(result.error.code)
        return
      }

      switch (result.data.status) {
        case 'REOPENED':
          setDialog(null)
          applyAuthoritativeSession(result.data.session, {
            activate: result.data.session.status === 'OPEN'
          })
          setStatusMessage('Screening session reopened.')
          await loadSessions(filters)
          break
        case 'SESSION_VERSION_CONFLICT':
          setDialog(null)
          applyAuthoritativeSession(result.data.session)
          setStatusMessage(
            'This screening session changed. Review the latest status before trying again.',
            'ALERT'
          )
          await loadSessions(filters)
          break
        case 'ALREADY_OPEN':
          setDialog(null)
          applyAuthoritativeSession(result.data.session)
          setStatusMessage('This screening session is already open.')
          await loadSessions(filters)
          break
        case 'NOT_FOUND':
          setDialog(null)
          setSelectedSessionId(null)
          setSelectedSession(null)
          setActiveSessionId(null)
          setStatusMessage('The screening session is no longer available.', 'ALERT')
          await loadSessions(filters)
          break
        case 'FORBIDDEN':
          setDialog(null)
          setStatusMessage(
            'Only nurses and local administrators can reopen a closed session.',
            'ALERT'
          )
          break
      }
    } catch {
      if (mountedRef.current && securityEpochRef.current === startedSecurityEpoch) {
        setStatusMessage(getScreeningSessionFailureMessage('IPC_UNAVAILABLE'), 'ALERT')
      }
    } finally {
      if (mutationRequestRef.current === requestId) {
        mutationPendingRef.current = false
        setOperationPending(false)
      }
    }
  }

  function openCloseDialog(session: PublicScreeningSession): void {
    setDialog({ kind: 'CLOSE', session, reason: '', error: null })
  }

  function openReopenDialog(session: PublicScreeningSession): void {
    setDialog({ kind: 'REOPEN', session, reason: '', error: null })
  }

  function updateFilters(next: Partial<SessionListFilters>): void {
    setFilters((current) => {
      const candidate = { ...current, ...next, page: next.page ?? 1 }

      return areSessionListFiltersEqual(current, candidate) ? current : candidate
    })
  }

  return (
    <>
      <section className="screening-workspace" aria-labelledby={headingId}>
        <div className="screening-workspace-heading">
          <div>
            <p className="application-workspace-kicker">Screening</p>
            <h1 ref={headingRef} id={headingId} tabIndex={-1}>
              Today&apos;s Screening Session
            </h1>
            <p>Current daily screening session.</p>
          </div>
          <div className="screening-offline-badge" aria-label="Offline ready">
            <span
              className="screening-status-dot screening-status-dot-success"
              aria-hidden="true"
            />
            Offline ready
          </div>
        </div>

        {message !== null ? (
          <div
            ref={messageRef}
            className={
              message.tone === 'ALERT'
                ? 'screening-message screening-message-alert'
                : 'screening-message'
            }
            role={message.tone === 'ALERT' ? 'alert' : 'status'}
            tabIndex={-1}
          >
            {message.text}
          </div>
        ) : null}

        <div className="screening-layout">
          <section className="screening-context-card" aria-labelledby="screening-context-title">
            <div className="screening-card-header">
              <div>
                <h2 id="screening-context-title">Configured location</h2>
                <p>Screening location and local date.</p>
              </div>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void loadContext()}
              >
                Refresh
              </button>
            </div>

            {contextState.status === 'LOADING' ? (
              <p className="screening-state-note" role="status">
                Resolving today&apos;s screening session...
              </p>
            ) : null}
            {contextState.status === 'ERROR' ? (
              <div className="screening-message screening-message-alert" role="alert">
                {contextState.message}
              </div>
            ) : null}
            {contextState.status === 'READY' ? (
              <>
                <div className="screening-context-grid">
                  <div className="screening-readonly-field">
                    <span>Configured location</span>
                    <strong>{activeLocation?.name ?? 'Not available'}</strong>
                  </div>
                  <div className="screening-readonly-field">
                    <span>Today</span>
                    <strong>{deploymentLocalDate}</strong>
                  </div>
                </div>
                {activeLocation !== null && todaySessionForActiveLocation !== null ? (
                  <p className="screening-state-note" role="status">
                    {todaySessionForActiveLocation.status === 'OPEN'
                      ? "Today's session is open."
                      : "Today's session is closed."}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          <section className="screening-session-card" aria-labelledby="screening-session-title">
            <div className="screening-card-header">
              <div>
                <h2 id="screening-session-title">Session details</h2>
                <p>Review status and available actions.</p>
              </div>
              {selectedSession !== null ? (
                <ScreeningSessionStatusBadge status={selectedSession.status} />
              ) : null}
            </div>
            {selectedSession === null ? (
              <div className="screening-empty-state" role="status">
                Today&apos;s screening session is not available.
              </div>
            ) : (
              <SessionDetail
                session={selectedSession}
                locationName={selectedSessionLocationName}
                isActive={activeSessionId === selectedSession.id && selectedSessionCanBeActive}
                canActivate={selectedSessionCanBeActive}
                canReopen={canReopen}
                commandId={commandId}
                operationPending={operationPending}
                onUseSession={() => {
                  if (!selectedSessionCanBeActive) {
                    setActiveSessionId(null)
                    setStatusMessage(
                      "Only today's open session for the configured location can be active.",
                      'ALERT'
                    )
                    return
                  }

                  setActiveSessionId(selectedSession.id)
                  setStatusMessage('Session selected.')
                }}
                onRefresh={() => void loadSessionById(selectedSession.id)}
                onClose={() => openCloseDialog(selectedSession)}
                onReopen={() => openReopenDialog(selectedSession)}
                onOpenNewScreening={() => {
                  setStatusMessage('Patient enrollment is not available yet.', 'STATUS')
                }}
              />
            )}
          </section>

          <section className="screening-worklist-card" aria-labelledby="screening-worklist-title">
            <div className="screening-card-header">
              <div>
                <h2 id="screening-worklist-title">Session worklist</h2>
                <p>Find sessions by status and date.</p>
              </div>
            </div>
            <div className="screening-filter-grid">
              <label className="screening-field">
                <span>Status</span>
                <select
                  value={filters.status ?? ''}
                  onChange={(event) => {
                    updateFilters({
                      status:
                        event.currentTarget.value === ''
                          ? null
                          : (event.currentTarget.value as ScreeningSessionStatus)
                    })
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>
              <label className="screening-field">
                <span>From date</span>
                <input
                  type="date"
                  value={filters.dateFrom ?? ''}
                  onChange={(event) =>
                    updateFilters({ dateFrom: event.currentTarget.value || null })
                  }
                />
              </label>
              <label className="screening-field">
                <span>To date</span>
                <input
                  type="date"
                  value={filters.dateTo ?? ''}
                  onChange={(event) => updateFilters({ dateTo: event.currentTarget.value || null })}
                />
              </label>
              <label className="screening-field">
                <span>Page size</span>
                <select
                  value={filters.pageSize}
                  onChange={(event) => {
                    updateFilters({
                      pageSize: Number(event.currentTarget.value) as ScreeningSessionPageSize
                    })
                  }}
                >
                  {screeningSessionPageSizes.map((pageSize) => (
                    <option key={pageSize} value={pageSize}>
                      {pageSize}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SessionWorklist
              state={listState}
              locations={activeLocations}
              selectedSessionId={selectedSessionId}
              onSelect={(session) => {
                applyAuthoritativeSession(session)
                void loadSessionById(session.id)
              }}
            />
            <div className="screening-pagination">
              <span role="status">
                {displayedRange === null
                  ? 'No page loaded.'
                  : `Showing ${displayedRange} sessions.`}
              </span>
              <div>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={filters.page <= 1 || listState.status === 'LOADING'}
                  onClick={() => updateFilters({ page: Math.max(1, filters.page - 1) })}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={listState.status !== 'READY' || filters.page >= totalPages}
                  onClick={() => updateFilters({ page: filters.page + 1 })}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>

      {dialog !== null ? (
        <ScreeningSessionDialog
          title={dialogTitle(dialog)}
          pending={operationPending}
          onCancel={() => setDialog(null)}
        >
          {dialog.error !== null ? (
            <div
              ref={dialogErrorRef}
              className="screening-message screening-message-alert"
              role="alert"
              tabIndex={-1}
            >
              {dialog.error}
            </div>
          ) : null}
          {dialog.kind === 'CLOSE' ? (
            <CloseSessionDialogContent
              dialog={dialog}
              locations={activeLocations}
              pending={operationPending}
              onDialogChange={setDialog}
              onSubmit={() => void submitClose()}
            />
          ) : null}
          {dialog.kind === 'REOPEN' ? (
            <ReopenSessionDialogContent
              dialog={dialog}
              locations={activeLocations}
              pending={operationPending}
              canReopen={canReopen}
              onDialogChange={setDialog}
              onSubmit={() => void submitReopen()}
            />
          ) : null}
        </ScreeningSessionDialog>
      ) : null}
    </>
  )
}

function SessionDetail({
  session,
  locationName,
  isActive,
  canActivate,
  canReopen,
  commandId,
  operationPending,
  onUseSession,
  onRefresh,
  onClose,
  onReopen,
  onOpenNewScreening
}: {
  readonly session: PublicScreeningSession
  readonly locationName: string
  readonly isActive: boolean
  readonly canActivate: boolean
  readonly canReopen: boolean
  readonly commandId: ScreeningSessionWorkspaceCommandId
  readonly operationPending: boolean
  onUseSession(): void
  onRefresh(): void
  onClose(): void
  onReopen(): void
  onOpenNewScreening(): void
}): React.JSX.Element {
  return (
    <div className="screening-session-detail">
      <dl className="screening-detail-grid">
        <div>
          <dt>Location</dt>
          <dd>{locationName}</dd>
        </div>
        <div>
          <dt>Session date</dt>
          <dd>{session.sessionDate}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{formatScreeningSessionStatus(session.status)}</dd>
        </div>
        <div>
          <dt>Protocol</dt>
          <dd>{formatProtocolVersionLabel(session.protocolVersionId)}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{formatScreeningSessionTimestamp(session.openedAt)}</dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>{formatScreeningSessionTimestamp(session.closedAt)}</dd>
        </div>
        <div>
          <dt>Current row version</dt>
          <dd>{session.rowVersion}</dd>
        </div>
        <div>
          <dt>Workspace selection</dt>
          <dd>{isActive ? 'Selected for this workspace' : 'Not selected'}</dd>
        </div>
      </dl>
      {session.notes !== null ? (
        <div className="screening-notes">
          <strong>Session notes</strong>
          <p>{session.notes}</p>
        </div>
      ) : null}
      {commandId === 'SCREENING_NEW_SCREENING' ? (
        <div className="screening-message" role="status">
          Patient enrollment is not available yet.
        </div>
      ) : null}
      <div className="screening-action-row">
        <button
          type="button"
          className="button button-secondary"
          disabled={!canActivate}
          onClick={onUseSession}
        >
          Select session
        </button>
        <button type="button" className="button button-secondary" onClick={onRefresh}>
          Reload session
        </button>
        {session.status === 'OPEN' ? (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={operationPending || !canActivate}
              onClick={commandId === 'SCREENING_NEW_SCREENING' ? onOpenNewScreening : onUseSession}
            >
              New Screening
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={operationPending}
              onClick={onClose}
            >
              Close session
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={!canReopen || operationPending}
              aria-describedby={!canReopen ? 'screening-reopen-restricted' : undefined}
              onClick={onReopen}
            >
              Reopen session
            </button>
            {!canReopen ? (
              <p id="screening-reopen-restricted" className="screening-restricted-note">
                Only nurses and local administrators can reopen a closed session.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function SessionWorklist({
  state,
  locations,
  selectedSessionId,
  onSelect
}: {
  readonly state: SessionListState
  readonly locations: readonly PublicScreeningSessionWorkspaceLocation[]
  readonly selectedSessionId: string | null
  onSelect(session: PublicScreeningSession): void
}): React.JSX.Element {
  if (state.status === 'IDLE') {
    return (
      <div className="screening-empty-state" role="status">
        Resolve today&apos;s session to load screening sessions.
      </div>
    )
  }

  if (state.status === 'LOADING') {
    return (
      <div className="screening-empty-state" role="status">
        Loading screening sessions.
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

  if (state.status === 'EMPTY') {
    return (
      <div className="screening-empty-state" role="status">
        No screening sessions match these filters.
      </div>
    )
  }

  return (
    <div className="screening-table-scroll">
      <table className="screening-worklist-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Location</th>
            <th scope="col">Status</th>
            <th scope="col">Opened</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {state.items.map((session) => (
            <tr key={session.id} aria-selected={selectedSessionId === session.id}>
              <td>{session.sessionDate}</td>
              <td>{resolveLocationName(session.locationId, locations)}</td>
              <td>
                <ScreeningSessionStatusBadge status={session.status} />
              </td>
              <td>{formatScreeningSessionTimestamp(session.openedAt)}</td>
              <td>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onSelect(session)}
                >
                  Inspect
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScreeningSessionStatusBadge({
  status
}: {
  readonly status: ScreeningSessionStatus
}): React.JSX.Element {
  return (
    <span className={`screening-status-badge screening-status-badge-${status.toLowerCase()}`}>
      <span
        className={`screening-status-dot ${
          status === 'OPEN' ? 'screening-status-dot-success' : 'screening-status-dot-neutral'
        }`}
        aria-hidden="true"
      />
      {formatScreeningSessionStatus(status)}
    </span>
  )
}

function CloseSessionDialogContent({
  dialog,
  locations,
  pending,
  onDialogChange,
  onSubmit
}: {
  readonly dialog: Exclude<DialogState, null> & { readonly kind: 'CLOSE' }
  readonly locations: readonly PublicScreeningSessionWorkspaceLocation[]
  readonly pending: boolean
  onDialogChange(dialog: DialogState): void
  onSubmit(): void
}): React.JSX.Element {
  return (
    <>
      <p className="screening-dialog-copy">
        Close {createSessionIdentityText(dialog.session, locations)}. This records the session as
        closed.
      </p>
      <label className="screening-field">
        <span>Close reason (optional)</span>
        <textarea
          value={dialog.reason}
          maxLength={1000}
          disabled={pending}
          onChange={(event) =>
            onDialogChange({ ...dialog, reason: event.currentTarget.value, error: null })
          }
        />
      </label>
      <div className="screening-dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={pending}
          onClick={onSubmit}
        >
          Close session
        </button>
      </div>
    </>
  )
}

function ReopenSessionDialogContent({
  dialog,
  locations,
  pending,
  canReopen,
  onDialogChange,
  onSubmit
}: {
  readonly dialog: Exclude<DialogState, null> & { readonly kind: 'REOPEN' }
  readonly locations: readonly PublicScreeningSessionWorkspaceLocation[]
  readonly pending: boolean
  readonly canReopen: boolean
  onDialogChange(dialog: DialogState): void
  onSubmit(): void
}): React.JSX.Element {
  return (
    <>
      <p className="screening-dialog-copy">
        Reopen {createSessionIdentityText(dialog.session, locations)} with a reason.
      </p>
      {!canReopen ? (
        <p className="screening-restricted-note" role="status">
          Only nurses and local administrators can reopen a closed session.
        </p>
      ) : null}
      <label className="screening-field">
        <span>
          Reopen reason <span className="visually-hidden">required</span>
        </span>
        <textarea
          value={dialog.reason}
          maxLength={1000}
          disabled={pending || !canReopen}
          aria-required="true"
          onChange={(event) =>
            onDialogChange({ ...dialog, reason: event.currentTarget.value, error: null })
          }
        />
      </label>
      <div className="screening-dialog-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={pending || !canReopen}
          onClick={onSubmit}
        >
          Reopen session
        </button>
      </div>
    </>
  )
}

function ScreeningSessionDialog({
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
    <div className="screening-dialog-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="screening-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screening-dialog-title"
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
        <h2 ref={headingRef} id="screening-dialog-title" tabIndex={-1}>
          {title}
        </h2>
        {children}
        <div className="screening-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function dialogTitle(dialog: Exclude<DialogState, null>): string {
  switch (dialog.kind) {
    case 'CLOSE':
      return 'Close screening session'
    case 'REOPEN':
      return 'Reopen screening session'
  }
}

function areSessionListFiltersEqual(left: SessionListFilters, right: SessionListFilters): boolean {
  return (
    left.status === right.status &&
    left.dateFrom === right.dateFrom &&
    left.dateTo === right.dateTo &&
    left.page === right.page &&
    left.pageSize === right.pageSize
  )
}

function getEnsureCurrentStatusMessage(
  status: Exclude<ScreeningSessionEnsureCurrentSuccessData['status'], 'RESOLVED' | 'CREATED'>
): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required before screening can begin.'
    case 'FORBIDDEN':
      return 'The active session is not authorized for Screening.'
    case 'LOCATION_NOT_CONFIGURED':
      return 'This installation does not have a configured screening location.'
    case 'LOCATION_NOT_FOUND':
      return 'The configured screening location is no longer available.'
    case 'LOCATION_INACTIVE':
      return 'The configured screening location is inactive.'
    case 'SESSION_CLOSED':
      return "Today's screening session is closed."
    case 'SESSION_CONFLICT':
      return "Today's screening session could not be resolved. Try again."
    case 'NO_ACTIVE_PROTOCOL':
      return 'No active screening protocol is available.'
    case 'UNAVAILABLE':
      return 'Session tools are unavailable. Try again after local services reconnect.'
  }
}

function isSessionInspectableInWorkspace(
  session: PublicScreeningSession,
  contextState: WorkspaceContextState,
  activeLocationId: string | null
): boolean {
  return (
    contextState.status === 'READY' &&
    activeLocationId !== null &&
    session.locationId === activeLocationId &&
    contextState.activeLocations.some((location) => location.id === session.locationId)
  )
}

function isSessionActiveInWorkspace(
  session: PublicScreeningSession,
  contextState: WorkspaceContextState,
  activeLocationId: string | null
): boolean {
  if (contextState.status !== 'READY') {
    return false
  }

  return (
    isSessionInspectableInWorkspace(session, contextState, activeLocationId) &&
    session.status === 'OPEN' &&
    session.sessionDate === contextState.deploymentLocalDate
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
