import { describe, expect, it, vi } from 'vitest'

import { createApplicationShellController } from '../../../src/renderer/src/app/shell/application-shell-controller'
import type { ApplicationShellState } from '../../../src/renderer/src/app/shell/application-shell-types'

describe('application shell controller', () => {
  it('starts at Home dashboard with the command panel closed', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: null,
      route: { status: 'DASHBOARD', commandId: 'HOME_DASHBOARD' }
    })
  })

  it('toggles menus and replaces the open command panel', () => {
    const states: ApplicationShellState[] = []
    const controller = createApplicationShellController({
      role: 'LOCAL_ADMIN',
      onState: (state) => states.push(state)
    })

    controller.toggleMenu('HOME')
    controller.toggleMenu('HOME')
    controller.openMenu('PATIENTS')

    expect(states.map((state) => [state.activeMenu, state.commandPanelMenu])).toEqual([
      ['HOME', 'HOME'],
      ['HOME', null],
      ['PATIENTS', 'PATIENTS']
    ])
  })

  it('routes dashboard and planned commands without leaving the command panel open', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.openMenu('PATIENTS')
    controller.selectCommand('PATIENTS_PATIENT_SEARCH')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'PATIENTS',
      commandPanelMenu: null,
      route: {
        status: 'PLANNED_MODULE',
        commandId: 'PATIENTS_PATIENT_SEARCH',
        heading: 'Patient Search',
        statement: 'Not available in this build.',
        plannedOwner: 'HSD-025 patient search and tabs'
      }
    })

    controller.selectCommand('HOME_DASHBOARD')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: null,
      route: { status: 'DASHBOARD', commandId: 'HOME_DASHBOARD' }
    })
  })

  it('ignores commands hidden from the fixed role', () => {
    const controller = createApplicationShellController({ role: 'TRAINED_SCREENER' })
    const before = controller.getSnapshot()

    controller.selectCommand('REPORTS_PATIENT_REPORTS')
    controller.selectCommand('REFERRALS_FOLLOW_UP_DUE')

    expect(controller.getSnapshot()).toBe(before)
  })

  it('freezes snapshots and ignores stale calls after dispose', () => {
    const listener = vi.fn()
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })
    const unsubscribe = controller.subscribe(listener)

    controller.selectCommand('PATIENTS_PATIENT_SEARCH')

    const plannedSnapshot = controller.getSnapshot()
    expect(Object.isFrozen(plannedSnapshot)).toBe(true)
    expect(Object.isFrozen(plannedSnapshot.route)).toBe(true)

    unsubscribe()
    controller.toggleMenu('REPORTS')
    expect(listener).toHaveBeenCalledTimes(1)

    const beforeDispose = controller.getSnapshot()
    controller.dispose()
    controller.openMenu('ADMINISTRATION')
    controller.selectCommand('ADMINISTRATION_USERS')

    expect(controller.getSnapshot()).toBe(beforeDispose)
  })
})
