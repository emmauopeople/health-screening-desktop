import type { LocalUserRole } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  isCommandVisibleToRole
} from './application-navigation-catalog'
import type {
  ApplicationCommandDefinition,
  ApplicationCommandId,
  ApplicationShellController,
  ApplicationShellState,
  ApplicationWorkspaceRoute,
  PrimaryApplicationMenu
} from './application-shell-types'

export interface ApplicationShellControllerOptions {
  readonly role: LocalUserRole
  readonly onState?: (state: ApplicationShellState) => void
}

const dashboardRoute: ApplicationWorkspaceRoute = Object.freeze({
  status: 'DASHBOARD',
  commandId: 'HOME_DASHBOARD'
})

export function createApplicationShellController({
  role,
  onState
}: ApplicationShellControllerOptions): ApplicationShellController {
  let disposed = false
  let state = freezeState({
    activeMenu: 'HOME',
    commandPanelMenu: 'HOME',
    route: dashboardRoute
  })
  const listeners = new Set<(state: ApplicationShellState) => void>()

  if (onState !== undefined) {
    listeners.add(onState)
  }

  function setState(nextState: ApplicationShellState): void {
    if (disposed) {
      return
    }

    state = freezeState(nextState)

    for (const listener of listeners) {
      listener(state)
    }
  }

  function openMenu(menu: PrimaryApplicationMenu): void {
    if (disposed) {
      return
    }

    setState({
      ...state,
      activeMenu: menu,
      commandPanelMenu: menu
    })
  }

  function closeCommandPanel(): void {
    if (disposed || state.commandPanelMenu === null) {
      return
    }

    setState({
      ...state,
      commandPanelMenu: null
    })
  }

  return Object.freeze({
    getSnapshot(): ApplicationShellState {
      return state
    },
    toggleMenu(menu: PrimaryApplicationMenu): void {
      if (disposed) {
        return
      }

      if (state.activeMenu === menu && state.commandPanelMenu === menu) {
        closeCommandPanel()
        return
      }

      openMenu(menu)
    },
    openMenu,
    closeCommandPanel,
    selectCommand(commandId: ApplicationCommandId): void {
      if (disposed) {
        return
      }

      const definition = getApplicationCommandDefinition(commandId)

      if (definition === null || !isCommandVisibleToRole(definition, role)) {
        return
      }

      setState({
        activeMenu: definition.menu,
        commandPanelMenu: definition.menu,
        route: createRouteForCommand(definition)
      })
    },
    subscribe(listener: (state: ApplicationShellState) => void): () => void {
      if (disposed) {
        return noop
      }

      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    dispose(): void {
      disposed = true
      listeners.clear()
    }
  })
}

function createRouteForCommand(
  definition: ApplicationCommandDefinition
): ApplicationWorkspaceRoute {
  if (definition.id === 'HOME_DASHBOARD') {
    return dashboardRoute
  }

  if (
    definition.id === 'HOME_QUICK_PATIENT_SEARCH' ||
    definition.id === 'PATIENTS_PATIENT_SEARCH' ||
    definition.id === 'PATIENTS_REGISTER_NEW_PATIENT' ||
    definition.id === 'PATIENTS_RECENT_PATIENTS' ||
    definition.id === 'PATIENTS_POSSIBLE_DUPLICATES'
  ) {
    return Object.freeze({
      status: 'PATIENTS',
      commandId:
        definition.id === 'HOME_QUICK_PATIENT_SEARCH' ? 'PATIENTS_PATIENT_SEARCH' : definition.id
    })
  }

  return Object.freeze({
    status: 'PLANNED_MODULE',
    commandId: definition.id,
    heading: definition.label,
    statement: 'Not available in this build.',
    plannedOwner: definition.plannedOwner ?? 'Future work package'
  })
}

function freezeState(state: ApplicationShellState): ApplicationShellState {
  return Object.freeze({
    activeMenu: state.activeMenu,
    commandPanelMenu: state.commandPanelMenu,
    route: state.route
  })
}

function noop(): void {
  return undefined
}
