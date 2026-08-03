import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

interface ApplicationShellProps {
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly busy: boolean
  readonly operationError: string | null
  readonly alertRef: React.RefObject<HTMLDivElement | null>
  onLock(): void
  onLogout(): void
}

const commandPanelId = 'application-command-panel'

export function ApplicationShell({
  context,
  user,
  busy,
  operationError,
  alertRef,
  onLock,
  onLogout
}: ApplicationShellProps): React.JSX.Element {
  const controller = useMemo(
    () => createApplicationShellController({ role: user.role }),
    [user.role]
  )
  const [state, setState] = useState<ApplicationShellState>(() => controller.getSnapshot())
  const [focusedMenu, setFocusedMenu] = useState<PrimaryApplicationMenu>(state.activeMenu)
  const topBarRef = useRef<HTMLElement | null>(null)
  const menuButtonRefs = useRef(new Map<PrimaryApplicationMenu, HTMLButtonElement>())
  const commandPanelRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLElement | null>(null)
  const workspaceHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const stateRef = useRef<ApplicationShellState>(state)
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
          getContainer: () => null,
          getFocusTarget: () => null
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

      controller.selectCommand(commandId)
    },
    [controller]
  )

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
        className="application-patient-tabs-anchor"
        data-shell-slot="patient-tabs"
        aria-hidden="true"
      />
      <ApplicationWorkspace
        context={context}
        user={user}
        route={state.route}
        workspaceRef={workspaceRef}
        headingRef={workspaceHeadingRef}
        onSelectCommand={selectCommand}
      />
      <footer className="application-shell-footer" data-shell-slot="footer">
        <span>Local data ready. Future workflow data is not shown in HSD-024.</span>
        <span>Version {context.applicationVersion} &bull; Offline-first desktop</span>
      </footer>
    </div>
  )
}
