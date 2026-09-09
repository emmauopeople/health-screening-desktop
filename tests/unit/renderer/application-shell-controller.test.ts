import { describe, expect, it, vi } from 'vitest'

import { createApplicationShellController } from '../../../src/renderer/src/app/shell/application-shell-controller'
import type { ApplicationShellState } from '../../../src/renderer/src/app/shell/application-shell-types'

describe('application shell controller', () => {
  it('starts at Home dashboard with the Home command panel open', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: 'HOME',
      selectedCommandId: 'HOME_DASHBOARD',
      route: { status: 'DASHBOARD', commandId: 'HOME_DASHBOARD' }
    })
  })

  it('opens primary menus by navigating to their explicit default command', () => {
    const states: ApplicationShellState[] = []
    const controller = createApplicationShellController({
      role: 'LOCAL_ADMIN',
      onState: (state) => states.push(state)
    })

    controller.openMenu('PATIENTS')
    controller.openMenu('SCREENING')
    controller.openMenu('REFERRALS')
    controller.openMenu('REPORTS')
    controller.openMenu('ADMINISTRATION')
    controller.openMenu('HOME')

    expect(states.map((state) => state.selectedCommandId)).toEqual([
      'PATIENTS_PATIENT_SEARCH',
      'SCREENING_TODAYS_SESSION',
      'REFERRALS_REFERRAL_WORKLIST',
      'REPORTS_PATIENT_REPORTS',
      'ADMINISTRATION_LOCATIONS',
      'HOME_DASHBOARD'
    ])
    expect(states.every((state) => state.activeMenu === state.commandPanelMenu)).toBe(true)
  })

  it('routes dashboard and patient commands while keeping the selected menu panel open', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.openMenu('PATIENTS')
    controller.selectCommand('PATIENTS_PATIENT_SEARCH')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'PATIENTS',
      commandPanelMenu: 'PATIENTS',
      selectedCommandId: 'PATIENTS_PATIENT_SEARCH',
      route: {
        status: 'PATIENTS',
        commandId: 'PATIENTS_PATIENT_SEARCH'
      }
    })

    controller.selectCommand('HOME_DASHBOARD')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: 'HOME',
      selectedCommandId: 'HOME_DASHBOARD',
      route: { status: 'DASHBOARD', commandId: 'HOME_DASHBOARD' }
    })
  })

  it('changes only the route when selecting a command from the open Home panel', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.selectCommand('HOME_TODAYS_SESSION')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: 'HOME',
      selectedCommandId: 'HOME_TODAYS_SESSION',
      route: {
        status: 'SCREENING_SESSIONS',
        commandId: 'SCREENING_TODAYS_SESSION'
      }
    })
  })

  it('keeps Home Quick Patient Search selected while routing to patient search', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.selectCommand('HOME_QUICK_PATIENT_SEARCH')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: 'HOME',
      selectedCommandId: 'HOME_QUICK_PATIENT_SEARCH',
      route: {
        status: 'PATIENTS',
        commandId: 'PATIENTS_PATIENT_SEARCH'
      }
    })
  })

  it('routes Administration location settings as the available admin workspace', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.selectCommand('ADMINISTRATION_LOCATIONS')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'ADMINISTRATION',
      commandPanelMenu: 'ADMINISTRATION',
      selectedCommandId: 'ADMINISTRATION_LOCATIONS',
      route: {
        status: 'ADMINISTRATION',
        commandId: 'ADMINISTRATION_LOCATIONS'
      }
    })
  })

  it('routes the available administrator Sync Center workspace', () => {
    const controller = createApplicationShellController({ role: 'LOCAL_ADMIN' })

    controller.selectCommand('ADMINISTRATION_SYNC_CENTER')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'ADMINISTRATION',
      commandPanelMenu: 'ADMINISTRATION',
      selectedCommandId: 'ADMINISTRATION_SYNC_CENTER',
      route: {
        status: 'ADMINISTRATION',
        commandId: 'ADMINISTRATION_SYNC_CENTER'
      }
    })
  })

  it('routes Patient Reports as the default available Reports workspace', () => {
    const controller = createApplicationShellController({ role: 'NURSE' })

    controller.openMenu('REPORTS')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'REPORTS',
      commandPanelMenu: 'REPORTS',
      selectedCommandId: 'REPORTS_PATIENT_REPORTS',
      route: {
        status: 'PATIENT_REPORTS',
        commandId: 'REPORTS_PATIENT_REPORTS'
      }
    })
  })

  it('routes Referral Reports as an available Reports workspace', () => {
    const controller = createApplicationShellController({ role: 'NURSE' })

    controller.selectCommand('REPORTS_REFERRAL_REPORTS')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'REPORTS',
      commandPanelMenu: 'REPORTS',
      selectedCommandId: 'REPORTS_REFERRAL_REPORTS',
      route: {
        status: 'REFERRAL_REPORTS',
        commandId: 'REPORTS_REFERRAL_REPORTS'
      }
    })
  })

  it('routes each referral workflow tab to the shared referrals workspace', () => {
    const controller = createApplicationShellController({ role: 'NURSE' })

    for (const commandId of [
      'REFERRALS_FOLLOW_UP_DUE',
      'REFERRALS_CLOSED_REFERRALS',
      'REFERRALS_PRINT_QUEUE'
    ] as const) {
      controller.selectCommand(commandId)
      expect(controller.getSnapshot().route).toEqual({ status: 'REFERRALS', commandId })
    }
  })

  it('routes Export / Print as an available patient PDF workspace', () => {
    const controller = createApplicationShellController({ role: 'NURSE' })

    controller.selectCommand('REPORTS_EXPORT_PRINT')

    expect(controller.getSnapshot()).toEqual({
      activeMenu: 'REPORTS',
      commandPanelMenu: 'REPORTS',
      selectedCommandId: 'REPORTS_EXPORT_PRINT',
      route: {
        status: 'EXPORT_PRINT',
        commandId: 'REPORTS_EXPORT_PRINT'
      }
    })
  })

  it('routes Audit Reports only for the local administrator', () => {
    const administrator = createApplicationShellController({ role: 'LOCAL_ADMIN' })
    const nurse = createApplicationShellController({ role: 'NURSE' })

    administrator.selectCommand('REPORTS_AUDIT_REPORTS')
    nurse.selectCommand('REPORTS_AUDIT_REPORTS')

    expect(administrator.getSnapshot()).toEqual({
      activeMenu: 'REPORTS',
      commandPanelMenu: 'REPORTS',
      selectedCommandId: 'REPORTS_AUDIT_REPORTS',
      route: {
        status: 'AUDIT_REPORTS',
        commandId: 'REPORTS_AUDIT_REPORTS'
      }
    })
    expect(nurse.getSnapshot()).toEqual({
      activeMenu: 'HOME',
      commandPanelMenu: 'HOME',
      selectedCommandId: 'HOME_DASHBOARD',
      route: { status: 'DASHBOARD', commandId: 'HOME_DASHBOARD' }
    })
  })

  it('ignores commands hidden from the fixed role', () => {
    const controller = createApplicationShellController({ role: 'TRAINED_SCREENER' })
    const before = controller.getSnapshot()

    controller.selectCommand('REPORTS_PATIENT_REPORTS')
    controller.selectCommand('REFERRALS_FOLLOW_UP_DUE')
    controller.openMenu('REPORTS')
    controller.openMenu('ADMINISTRATION')

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
