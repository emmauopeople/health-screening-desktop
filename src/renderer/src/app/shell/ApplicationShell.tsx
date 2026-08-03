import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthenticationErrorCode, HealthScreeningApi, PublicPatientSummary } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  getVisibleApplicationCommands,
  getVisibleApplicationMenus
} from './application-navigation-catalog'
import { createApplicationShellController } from './application-shell-controller'
import {
  createApplicationShellFocusCycler,
  getMenuFromIndex,
  resolvePrimaryMenuKey,
  type ApplicationShellFocusZoneDefinition
} from './application-shell-focus'
import type {
  ApplicationCommandId,
  ApplicationShellContext,
  ApplicationShellState,
  ApplicationShellUser,
  PrimaryApplicationMenu
} from './application-shell-types'
import { ApplicationTopBar } from './ApplicationTopBar'
import { ApplicationWorkspace } from './ApplicationWorkspace'
import { ContextCommandPanel } from './ContextCommandPanel'
import {
  closePatientTab,
  DirtyPatientTabDialog,
  emptyPatientTabState,
  getActivePatientTab,
  isPatientTabDirty,
  openPatientTab,
  PatientTabsBar,
  refreshPatientTabSummary,
  replacePatientTab,
  ReplacePatientDialog,
  type PatientTabState,
  type PatientWorkspaceTab
} from '../patients'

interface ApplicationShellProps {
  readonly api: HealthScreeningApi
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly busy: boolean
  readonly operationError: string | null
  readonly alertRef: React.RefObject<HTMLDivElement | null>
  onLock(): void
  onLogout(): void
  onAuthenticationFailure(code: AuthenticationErrorCode): void
}

const commandPanelId = 'application-command-panel'

export function ApplicationShell({
  api,
  context,
  user,
  busy,
  operationError,
  alertRef,
  onLock,
  onLogout,
  onAuthenticationFailure
}: ApplicationShellProps): React.JSX.Element {
  const controller = useMemo(
    () => createApplicationShellController({ role: user.role }),
    [user.role]
  )
  const [state, setState] = useState<ApplicationShellState>(() => controller.getSnapshot())
  const [focusedMenu, setFocusedMenu] = useState<PrimaryApplicationMenu>(state.activeMenu)
  const [patientTabState, setPatientTabState] = useState<PatientTabState>(emptyPatientTabState)
  const [patientOverviewActive, setPatientOverviewActive] = useState(false)
  const [patientSearchInitialQuery, setPatientSearchInitialQuery] = useState('')
  const [patientSearchFocusSignal, setPatientSearchFocusSignal] = useState(0)
  const [pendingReplacePatient, setPendingReplacePatient] = useState<PublicPatientSummary | null>(
    null
  )
  const [dirtyDialogTab, setDirtyDialogTab] = useState<PatientWorkspaceTab | null>(null)
  const topBarRef = useRef<HTMLElement | null>(null)
  const menuButtonRefs = useRef(new Map<PrimaryApplicationMenu, HTMLButtonElement>())
  const commandPanelRef = useRef<HTMLElement | null>(null)
  const patientTabsRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const workspaceHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const stateRef = useRef<ApplicationShellState>(state)
  const patientTabStateRef = useRef<PatientTabState>(patientTabState)
  const focusedMenuRef = useRef<PrimaryApplicationMenu>(focusedMenu)
  const menus = useMemo(() => getVisibleApplicationMenus(user.role), [user.role])
  const visibleMenuIds = useMemo(() => menus.map((menu) => menu.id), [menus])
  const visibleCommands = state.commandPanelMenu
    ? getVisibleApplicationCommands(user.role, state.commandPanelMenu)
    : []

  useEffect(() => {
    return controller.subscribe(setState)
  }, [controller])

  useEffect(() => {
    return () => {
      controller.dispose()
    }
  }, [controller])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    patientTabStateRef.current = patientTabState
  }, [patientTabState])

  useEffect(() => {
    focusedMenuRef.current = focusedMenu
  }, [focusedMenu])

  useEffect(() => {
    workspaceHeadingRef.current?.focus({ preventScroll: true })
  }, [state.route.commandId])

  useEffect(() => {
    const cycler = createApplicationShellFocusCycler({
      getZones: (): readonly ApplicationShellFocusZoneDefinition[] => [
        {
          id: 'TOP_BAR',
          getContainer: () => topBarRef.current,
          getFocusTarget: () =>
            menuButtonRefs.current.get(focusedMenuRef.current) ??
            menuButtonRefs.current.get(stateRef.current.activeMenu) ??
            topBarRef.current?.querySelector<HTMLButtonElement>('button') ??
            null
        },
        {
          id: 'COMMAND_PANEL',
          getContainer: () => {
            if (stateRef.current.commandPanelMenu === null) {
              return null
            }

            return commandPanelRef.current
          },
          getFocusTarget: () => {
            if (stateRef.current.commandPanelMenu === null) {
              return null
            }

            return (
              commandPanelRef.current?.querySelector<HTMLButtonElement>('button') ??
              commandPanelRef.current
            )
          }
        },
        {
          id: 'PATIENT_TABS',
          getContainer: () =>
            patientTabStateRef.current.tabs.length > 0 ? patientTabsRef.current : null,
          getFocusTarget: () =>
            patientTabStateRef.current.tabs.length > 0
              ? (patientTabsRef.current?.querySelector<HTMLButtonElement>('[role="tab"]') ?? null)
              : null
        },
        {
          id: 'WORKSPACE',
          getContainer: () => workspaceRef.current,
          getFocusTarget: () => workspaceHeadingRef.current ?? workspaceRef.current
        }
      ]
    })

    return () => {
      cycler.dispose()
    }
  }, [])

  const focusMenuButton = useCallback((menu: PrimaryApplicationMenu) => {
    menuButtonRefs.current.get(menu)?.focus({ preventScroll: true })
  }, [])

  const selectCommand = useCallback(
    (commandId: ApplicationCommandId) => {
      const definition = getApplicationCommandDefinition(commandId)

      if (definition !== null) {
        setFocusedMenu(definition.menu)
      }

      setPatientOverviewActive(false)
      if (commandId === 'HOME_QUICK_PATIENT_SEARCH' || commandId === 'PATIENTS_PATIENT_SEARCH') {
        setPatientSearchInitialQuery('')
        setPatientSearchFocusSignal((value) => value + 1)
      }

      controller.selectCommand(commandId)
    },
    [controller]
  )

  const handlePatientAuthenticationFailure = useCallback(
    (code: AuthenticationErrorCode) => {
      setPatientTabState(emptyPatientTabState)
      setPatientOverviewActive(false)
      setPendingReplacePatient(null)
      setDirtyDialogTab(null)
      onAuthenticationFailure(code)
    },
    [onAuthenticationFailure]
  )

  const loadPatientSummary = useCallback(
    async (patientId: string): Promise<PublicPatientSummary | null> => {
      const result = await api.patient.getSummary({ patientId })

      if (result.ok) {
        return result.data
      }

      if (isFailClosedPatientError(result.error.code)) {
        handlePatientAuthenticationFailure(result.error.code)
        return null
      }

      return null
    },
    [api, handlePatientAuthenticationFailure]
  )

  const activatePatient = useCallback(
    async (patientId: string) => {
      const summary = await loadPatientSummary(patientId)

      if (summary === null) {
        return
      }

      setPatientTabState((current) =>
        refreshPatientTabSummary(
          {
            ...current,
            activePatientId: patientId
          },
          summary
        )
      )
      setPatientOverviewActive(true)
    },
    [loadPatientSummary]
  )

  const openPatient = useCallback(
    async (patientId: string) => {
      const summary = await loadPatientSummary(patientId)

      if (summary === null) {
        return
      }

      setPatientTabState((current) => {
        const result = openPatientTab(current, summary)

        if (result.status === 'CAPACITY_REACHED') {
          setPendingReplacePatient(summary)
          return current
        }

        setPatientOverviewActive(true)
        return result.state
      })
    },
    [loadPatientSummary]
  )

  const requestClosePatient = useCallback((patientId: string) => {
    const tab = patientTabStateRef.current.tabs.find(
      (candidate) => candidate.patientId === patientId
    )

    if (tab === undefined) {
      return
    }

    if (isPatientTabDirty(patientTabStateRef.current, patientId)) {
      setDirtyDialogTab(tab)
      return
    }

    setPatientTabState((current) => closePatientTab(current, patientId))
  }, [])

  const closeActivePatient = useCallback(() => {
    const activeTab = getActivePatientTab(patientTabStateRef.current)

    if (activeTab === null) {
      return
    }

    requestClosePatient(activeTab.patientId)
  }, [requestClosePatient])

  const replaceOpenPatient = useCallback(
    (replacedPatientId: string) => {
      const pending = pendingReplacePatient

      if (pending === null) {
        return
      }

      const tab = patientTabStateRef.current.tabs.find(
        (candidate) => candidate.patientId === replacedPatientId
      )

      if (tab !== undefined && tab.dirty) {
        setDirtyDialogTab(tab)
        return
      }

      setPatientTabState((current) => replacePatientTab(current, replacedPatientId, pending))
      setPendingReplacePatient(null)
      setPatientOverviewActive(true)
    },
    [pendingReplacePatient]
  )

  const selectPatientSearch = useCallback(
    (query: string) => {
      setPatientOverviewActive(false)
      setPatientSearchInitialQuery(query)
      setPatientSearchFocusSignal((value) => value + 1)
      controller.selectCommand('PATIENTS_PATIENT_SEARCH')
      setFocusedMenu('PATIENTS')
    },
    [controller]
  )
  const activatePatientShortcutRef = useRef(activatePatient)
  const selectPatientSearchShortcutRef = useRef(selectPatientSearch)

  useEffect(() => {
    activatePatientShortcutRef.current = activatePatient
    selectPatientSearchShortcutRef.current = selectPatientSearch
  }, [activatePatient, selectPatientSearch])

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        selectPatientSearchShortcutRef.current('')
        return
      }

      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
        return
      }

      const index = Number.parseInt(event.key, 10)

      if (!Number.isInteger(index) || index < 1 || index > 4) {
        return
      }

      const tab = patientTabStateRef.current.tabs[index - 1]

      if (tab === undefined) {
        return
      }

      event.preventDefault()
      void activatePatientShortcutRef.current(tab.patientId)
    }

    window.addEventListener('keydown', listener)

    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [])

  const closeCommandPanel = useCallback(() => {
    controller.closeCommandPanel()
    focusMenuButton(stateRef.current.activeMenu)
  }, [controller, focusMenuButton])

  const handleMenuKeyDown = useCallback(
    (menu: PrimaryApplicationMenu, event: React.KeyboardEvent<HTMLButtonElement>) => {
      const menuIndex = visibleMenuIds.indexOf(menu)
      const result = resolvePrimaryMenuKey(event.key, menuIndex, visibleMenuIds.length)

      if (result.kind === 'NONE') {
        return
      }

      event.preventDefault()

      if (result.kind === 'MOVE') {
        const nextMenu = getMenuFromIndex(visibleMenuIds, result.nextIndex)

        if (nextMenu !== null) {
          setFocusedMenu(nextMenu)
          focusMenuButton(nextMenu)
        }

        return
      }

      if (result.kind === 'TOGGLE') {
        controller.toggleMenu(menu)
        return
      }

      closeCommandPanel()
    },
    [closeCommandPanel, controller, focusMenuButton, visibleMenuIds]
  )

  const handleShellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || state.commandPanelMenu === null) {
        return
      }

      event.preventDefault()
      closeCommandPanel()
    },
    [closeCommandPanel, state.commandPanelMenu]
  )

  const activePatient = patientOverviewActive
    ? (getActivePatientTab(patientTabState)?.summary ?? null)
    : null

  return (
    <div className="application-shell" onKeyDown={handleShellKeyDown}>
      <ApplicationTopBar
        context={context}
        displayName={user.displayName}
        role={user.role}
        menus={menus}
        activeMenu={state.activeMenu}
        commandPanelMenu={state.commandPanelMenu}
        focusedMenu={focusedMenu}
        busy={busy}
        commandPanelId={commandPanelId}
        topBarRef={topBarRef}
        onMenuClick={(menu) => {
          setFocusedMenu(menu)
          controller.toggleMenu(menu)
        }}
        onMenuFocus={setFocusedMenu}
        onMenuKeyDown={handleMenuKeyDown}
        onLock={onLock}
        onLogout={onLogout}
        registerMenuButton={(menu, element) => {
          if (element === null) {
            menuButtonRefs.current.delete(menu)
            return
          }

          menuButtonRefs.current.set(menu, element)
        }}
      />
      <div className="application-shell-alert-slot" data-shell-slot="operation-alert">
        {operationError !== null ? (
          <div
            ref={alertRef}
            className="auth-alert application-shell-alert"
            role="alert"
            tabIndex={-1}
          >
            {operationError}
          </div>
        ) : null}
      </div>
      <div className="application-command-panel-slot" data-shell-slot="contextual-panel">
        {state.commandPanelMenu !== null ? (
          <ContextCommandPanel
            id={commandPanelId}
            panelRef={commandPanelRef}
            menu={state.commandPanelMenu}
            commands={visibleCommands}
            currentCommandId={state.route.commandId}
            onCommand={selectCommand}
          />
        ) : null}
      </div>
      <div
        className={
          patientTabState.tabs.length > 0
            ? 'application-patient-tabs-slot'
            : 'application-patient-tabs-anchor'
        }
        data-shell-slot="patient-tabs"
      >
        <PatientTabsBar
          tabs={patientTabState.tabs}
          activePatientId={patientTabState.activePatientId}
          tabsRef={patientTabsRef}
          onActivate={(patientId) => {
            void activatePatient(patientId)
          }}
          onClose={requestClosePatient}
        />
      </div>
      <ApplicationWorkspace
        api={api}
        context={context}
        user={user}
        route={state.route}
        patientSearchInitialQuery={patientSearchInitialQuery}
        patientSearchFocusSignal={patientSearchFocusSignal}
        activePatient={activePatient}
        workspaceRef={workspaceRef}
        headingRef={workspaceHeadingRef}
        onSelectCommand={selectCommand}
        onPatientSearch={selectPatientSearch}
        onOpenPatient={(patientId) => {
          void openPatient(patientId)
        }}
        onBackToSearch={() => selectPatientSearch(patientSearchInitialQuery)}
        onCloseActivePatient={closeActivePatient}
        onAuthenticationFailure={handlePatientAuthenticationFailure}
      />
      {pendingReplacePatient !== null ? (
        <ReplacePatientDialog
          pendingPatient={pendingReplacePatient}
          tabs={patientTabState.tabs}
          onReplace={replaceOpenPatient}
          onCancel={() => setPendingReplacePatient(null)}
        />
      ) : null}
      {dirtyDialogTab !== null ? (
        <DirtyPatientTabDialog
          tab={dirtyDialogTab}
          pending={false}
          error={null}
          onSaveAndClose={() => setDirtyDialogTab(null)}
          onDiscardAndClose={() => {
            const closingId = dirtyDialogTab.patientId
            setDirtyDialogTab(null)
            setPatientTabState((current) => closePatientTab(current, closingId))
          }}
          onCancel={() => setDirtyDialogTab(null)}
        />
      ) : null}
      <footer className="application-shell-footer" data-shell-slot="footer">
        <span>Local patient registry ready. Clinical workflow data is not shown in HSD-025.</span>
        <span>Version {context.applicationVersion} &bull; Offline-first desktop</span>
      </footer>
    </div>
  )
}

function isFailClosedPatientError(code: AuthenticationErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED' ||
    code === 'AUTHENTICATION_UNAVAILABLE'
  )
}
