import type { LocalUserRole } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  getDefaultApplicationCommand,
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
    selectedCommandId: 'HOME_DASHBOARD',
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

    const defaultCommandId = getDefaultApplicationCommand(menu, role)

    if (defaultCommandId === null) {
      return
    }

    selectCommand(defaultCommandId)
  }

  function selectCommand(commandId: ApplicationCommandId): void {
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
      selectedCommandId: definition.id,
      route: createRouteForCommand(definition)
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
    selectCommand,
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
    definition.id === 'HOME_TODAYS_SESSION' ||
    definition.id === 'SCREENING_TODAYS_SESSION' ||
    definition.id === 'SCREENING_NEW_SCREENING'
  ) {
    return Object.freeze({
      status: 'SCREENING_SESSIONS',
      commandId:
        definition.id === 'HOME_TODAYS_SESSION' ? 'SCREENING_TODAYS_SESSION' : definition.id
    })
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

  if (definition.id === 'ADMINISTRATION_LOCATIONS') {
    return Object.freeze({
      status: 'ADMINISTRATION',
      commandId: definition.id
    })
  }

  if (definition.id === 'SCREENING_MANAGE_ENCOUNTERS') {
    return Object.freeze({
      status: 'MANAGE_ENCOUNTERS',
      commandId: definition.id
    })
  }

  if (definition.id === 'SCREENING_SESSION_SUMMARY') {
    return Object.freeze({
      status: 'SESSION_SUMMARY',
      commandId: definition.id
    })
  }

  if (definition.id === 'REPORTS_SESSION_REPORTS') {
    return Object.freeze({
      status: 'SESSION_REPORTS',
      commandId: definition.id
    })
  }

  if (definition.id === 'HOME_OPEN_REFERRALS' || definition.id === 'REFERRALS_REFERRAL_WORKLIST') {
    return Object.freeze({
      status: 'REFERRALS',
      commandId: definition.id
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
    selectedCommandId: state.selectedCommandId,
    route: state.route
  })
}

function noop(): void {
  return undefined
}
