// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createPatientFailure,
  createScreeningSessionFailure,
  type AuthGetSessionResult,
  type AuthLockResult,
  type AuthLogoutResult,
  type AuthRecordActivityResult,
  type AuthenticationSessionChangedListener,
  type FirstRunGetStateResult,
  type HealthScreeningApi,
  type LocalUserRole,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession,
  type PublicAuthenticatedUser,
  type PublicPatientDetail,
  type PublicPatientDuplicateCandidate,
  type PublicPatientSummary,
  type PublicLockedAuthenticationSession,
  type PublicPasswordChangeRequiredAuthenticationSession,
  type PublicScreeningEncounterStartSummary,
  type PublicSignedOutAuthenticationSession,
  type UtcTimestamp
} from '@shared/ipc'
import App from '../../../src/renderer/src/app/App'
import {
  ApplicationShell,
  type ApplicationShellContext,
  type ApplicationShellUser
} from '../../../src/renderer/src/app/shell'

const baseUser: PublicAuthenticatedUser = {
  username: 'Admin.User',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN'
}
const shellContext: ApplicationShellContext = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  deploymentName: 'Local Deployment',
  timeZone: 'Africa/Douala'
}
const shellUser: ApplicationShellUser = {
  username: baseUser.username,
  displayName: baseUser.displayName,
  role: baseUser.role
}

describe('application shell DOM integration', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders the full dashboard shell after setup complete and active session', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(text(mounted)).toContain('Local Deployment')
    expect(text(mounted)).toContain('No screening session open')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Home commands')
    expect(commandPanel(mounted)?.textContent).not.toContain('Home commands')
    expect(commandPanel(mounted)?.textContent).not.toContain('Available')
    expect(commandPanel(mounted)?.textContent).not.toContain('Planned')
    expect(menuButton(mounted, 'Home').getAttribute('aria-expanded')).toBe('true')
    expect(buttonByText(mounted, 'Dashboard').getAttribute('aria-current')).toBe('page')
    expect(primaryMenuLabels(mounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals',
      'Reports',
      'Administration'
    ])
    expect(text(mounted)).toContain('Screened today')
    expect(text(mounted)).toContain("Today's Patient Worklist")
    expect(text(mounted)).not.toContain('Today' + '\\u2019s patient worklist')
    expect(text(mounted)).not.toContain(`Today${String.fromCharCode(0x2019)}s patient worklist`)
    expect(text(mounted)).toContain('Patient code')
    expect(text(mounted)).toContain('Patient worklist data is not available in HSD-024.')
    expect(text(mounted)).toContain(
      'Patient search, registration, and worklist data are unavailable in HSD-024.'
    )
    expect(text(mounted)).not.toContain('Admin.User')
    expect(text(mounted)).not.toContain('No active location selected')
    expect(text(mounted)).not.toContain('Grace')
    expect(text(mounted)).not.toContain('BAB-')
    expect(text(mounted)).not.toContain('Yesterday')

    expect(summaryCards(mounted)).toHaveLength(5)
    expect(mounted.container.querySelector('.dashboard-lower-grid')).not.toBeNull()
    expect(mounted.container.querySelectorAll('.dashboard-lower-grid > section')).toHaveLength(2)
    expect(
      Array.from(mounted.container.querySelectorAll('.dashboard-quick-action-number')).map(
        (node) => node.textContent
      )
    ).toEqual(['1', '2', '3', '4'])
    expect(patientSearchInput(mounted).disabled).toBe(true)
    expect(buttonByText(mounted, 'Search').disabled).toBe(true)
    expect(buttonByText(mounted, 'Register patient').disabled).toBe(true)
    expect(worklistRows(mounted)).toHaveLength(1)
    expect(worklistRows(mounted)[0]?.querySelector('td')?.getAttribute('colspan')).toBe('6')

    await mounted.unmount()
  })

  it.each([
    {
      name: 'no alert and no panel',
      operationError: null,
      openPanel: false,
      hasAlert: false,
      hasPanel: false
    },
    {
      name: 'panel only',
      operationError: null,
      openPanel: true,
      hasAlert: false,
      hasPanel: true
    },
    {
      name: 'alert only',
      operationError: 'The desktop authentication service is unavailable.',
      openPanel: false,
      hasAlert: true,
      hasPanel: false
    },
    {
      name: 'alert plus panel',
      operationError: 'The desktop authentication service is unavailable.',
      openPanel: true,
      hasAlert: true,
      hasPanel: true
    }
  ])(
    'keeps deterministic application-shell slots for $name',
    async ({ operationError, openPanel, hasAlert, hasPanel }) => {
      const mounted = await mountShell({ operationError })

      if (openPanel) {
        await clickButton(mounted, 'Patients')
      } else if (commandPanel(mounted) !== null) {
        await dispatchKeyboard(commandPanel(mounted)!, 'Escape')
      }

      expectShellSlots(mounted, { hasAlert, hasPanel })

      await mounted.unmount()
    }
  )

  it('filters primary menus by active role', async () => {
    const nurseMounted = await mountApp(createAppApi(activeSession(1, userWithRole('NURSE'))).api)
    expect(primaryMenuLabels(nurseMounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals',
      'Reports'
    ])
    expect(text(nurseMounted)).not.toContain('Administration')
    await nurseMounted.unmount()

    const screenerMounted = await mountApp(
      createAppApi(activeSession(2, userWithRole('TRAINED_SCREENER'))).api
    )
    expect(primaryMenuLabels(screenerMounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals'
    ])
    expect(text(screenerMounted)).not.toContain('Reports')
    expect(text(screenerMounted)).not.toContain('Administration')
    await screenerMounted.unmount()
  })

  it('opens one contextual command panel at a time and restores focus on Escape', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')

    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')
    expect(menuButton(mounted, 'Patients').getAttribute('aria-expanded')).toBe('true')

    await clickButton(mounted, 'Screening')

    expect(commandPanel(mounted)?.textContent).toContain('New Screening')
    expect(commandPanel(mounted)?.textContent).not.toContain('Patient Search')
    expect(menuButton(mounted, 'Patients').getAttribute('aria-expanded')).toBe('false')

    await dispatchKeyboard(commandPanel(mounted)!, 'Escape')

    expect(commandPanel(mounted)).toBeNull()
    expect(document.activeElement).toBe(menuButton(mounted, 'Screening'))

    await mounted.unmount()
  })

  it('preserves contextual commands and current-page marks during workspace route changes', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Dashboard')

    expectCommandPanelLabels(mounted, [
      'Dashboard',
      'Patient Screening',
      'Quick Patient Search',
      'Open Referrals',
      'Sync Center'
    ])
    expect(commandButtonByText(mounted, 'Dashboard').getAttribute('aria-current')).toBe('page')

    await clickButton(mounted, 'Patient Screening')

    expectCommandPanelLabels(mounted, [
      'Dashboard',
      'Patient Screening',
      'Quick Patient Search',
      'Open Referrals',
      'Sync Center'
    ])
    expect(commandButtonByText(mounted, 'Patient Screening').getAttribute('aria-current')).toBe(
      'page'
    )
    expectWorkspaceHeading(mounted, 'Patients')

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Patient Search')

    expectCommandPanelLabels(mounted, [
      'Patient Search',
      'Register New Patient',
      'Recent Patients',
      'Possible Duplicates'
    ])
    expect(commandButtonByText(mounted, 'Patient Search').getAttribute('aria-current')).toBe('page')
    expect(commandPanel(mounted)?.textContent).not.toContain('Dashboard')

    await clickButton(mounted, 'Home')

    expectCommandPanelLabels(mounted, [
      'Dashboard',
      'Patient Screening',
      'Quick Patient Search',
      'Open Referrals',
      'Sync Center'
    ])

    await dispatchKeyboard(commandPanel(mounted)!, 'Escape')

    expect(commandPanel(mounted)).toBeNull()

    await mounted.unmount()
  })

  it('navigates primary menu clicks to default workspaces and keeps the default command current', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')

    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Patients commands')
    expect(commandButtonByText(mounted, 'Patient Search').getAttribute('aria-current')).toBe('page')
    expect(commandPanel(mounted)).not.toBeNull()

    await clickButton(mounted, 'Home')

    expectWorkspaceHeading(mounted, 'Welcome, Admin User')
    expect(text(mounted)).not.toContain('Patient Search and Management')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Home commands')
    expect(commandButtonByText(mounted, 'Dashboard').getAttribute('aria-current')).toBe('page')

    await clickButton(mounted, 'Patients')
    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandButtonByText(mounted, 'Patient Search').getAttribute('aria-current')).toBe('page')

    await clickButton(mounted, 'Screening')
    expectWorkspaceHeading(mounted, 'Patients')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Screening commands')
    expect(commandButtonByText(mounted, 'Patients').getAttribute('aria-current')).toBe('page')

    await clickButton(mounted, 'Referrals')
    expectWorkspaceHeading(mounted, 'Referral Worklist')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Referrals commands')
    expect(commandButtonByText(mounted, 'Referral Worklist').getAttribute('aria-current')).toBe(
      'page'
    )

    await clickButton(mounted, 'Reports')
    expectWorkspaceHeading(mounted, 'Patient Reports')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Reports commands')
    expect(commandButtonByText(mounted, 'Patient Reports').getAttribute('aria-current')).toBe(
      'page'
    )

    await clickButton(mounted, 'Administration')
    expectWorkspaceHeading(mounted, 'Users')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Administration commands')
    expect(commandButtonByText(mounted, 'Users').getAttribute('aria-current')).toBe('page')

    await mounted.unmount()
  })

  it.each([
    { role: 'NURSE' as const, displayName: 'Nurse User' },
    { role: 'LOCAL_ADMIN' as const, displayName: 'Admin User' }
  ])('navigates Referrals to Reports defaults for $role', async ({ role, displayName }) => {
    const mounted = await mountApp(
      createAppApi(activeSession(1, { ...baseUser, displayName, role })).api
    )

    await clickButton(mounted, 'Referrals')
    expectWorkspaceHeading(mounted, 'Referral Worklist')

    await clickButton(mounted, 'Reports')
    expectWorkspaceHeading(mounted, 'Patient Reports')
    expect(commandButtonByText(mounted, 'Patient Reports').getAttribute('aria-current')).toBe(
      'page'
    )

    await mounted.unmount()
  })

  it.each([
    ['Register New Patient', 'Register New Patient'],
    ['Recent Patients', 'Recent Patients'],
    ['Possible Duplicates', 'Possible Duplicates']
  ])(
    'clicking the active Patients menu returns %s to Patient Search',
    async (commandLabel, expectedHeading) => {
      const mounted = await mountApp(createAppApi(activeSession(1)).api)

      await clickButton(mounted, 'Patients')
      await clickButton(mounted, commandLabel)

      expectWorkspaceHeading(mounted, expectedHeading)

      await clickButton(mounted, 'Patients')

      expectWorkspaceHeading(mounted, 'Patient Search and Management')
      expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Patients commands')
      expect(commandButtonByText(mounted, 'Patient Search').getAttribute('aria-current')).toBe(
        'page'
      )

      await mounted.unmount()
    }
  )

  it('moves primary-menu focus without navigating and activates defaults on Enter or Space', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')
    expectWorkspaceHeading(mounted, 'Patient Search and Management')

    menuButton(mounted, 'Patients').focus()
    await dispatchKeyboard(menuButton(mounted, 'Patients'), 'ArrowRight')

    expect(document.activeElement).toBe(menuButton(mounted, 'Screening'))
    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Patients commands')

    await dispatchKeyboard(menuButton(mounted, 'Screening'), 'Enter')

    expectWorkspaceHeading(mounted, 'Patients')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Screening commands')

    menuButton(mounted, 'Home').focus()
    await dispatchKeyboard(menuButton(mounted, 'Home'), ' ')

    expectWorkspaceHeading(mounted, 'Welcome, Admin User')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Home commands')

    await mounted.unmount()
  })

  it('closes the contextual panel with Escape and reopens the primary menu at its default', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Recent Patients')
    expectWorkspaceHeading(mounted, 'Recent Patients')

    await dispatchKeyboard(commandPanel(mounted)!, 'Escape')

    expect(commandPanel(mounted)).toBeNull()
    expect(document.activeElement).toBe(menuButton(mounted, 'Patients'))

    await clickButton(mounted, 'Patients')

    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Patients commands')
    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandButtonByText(mounted, 'Patient Search').getAttribute('aria-current')).toBe('page')

    await mounted.unmount()
  })

  it('keeps Home Quick Patient Search selected while displaying patient search', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Quick Patient Search')

    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Home commands')
    expect(commandButtonByText(mounted, 'Quick Patient Search').getAttribute('aria-current')).toBe(
      'page'
    )
    expect(() => commandButtonByText(mounted, 'Patient Search')).toThrow(
      'Expected command button Patient Search'
    )

    await mounted.unmount()
  })

  it('does not render role-hidden menus or activate role-hidden defaults', async () => {
    const screenerMounted = await mountApp(
      createAppApi(activeSession(1, userWithRole('TRAINED_SCREENER'))).api
    )

    expect(primaryMenuLabels(screenerMounted)).toEqual([
      'Home',
      'Patients',
      'Screening',
      'Referrals'
    ])
    expect(() => menuButton(screenerMounted, 'Reports')).toThrow('Expected primary menu Reports')

    await clickButton(screenerMounted, 'Referrals')
    expectWorkspaceHeading(screenerMounted, 'Referral Worklist')

    await screenerMounted.unmount()
  })

  it('guards dirty patient edits during primary-menu navigation', async () => {
    const cancelCase = await mountDirtyPatientWorkspace(createPatientFailure('INTERNAL_ERROR'))

    await clickButton(cancelCase.mounted, 'Home')
    expect(text(cancelCase.mounted)).toContain('Save or discard the amendment before leaving.')
    await clickDialogButton(cancelCase.mounted, 'Cancel')

    expectWorkspaceHeading(cancelCase.mounted, 'Patient Search and Management')
    expect(text(cancelCase.mounted)).toContain('Draft amendment')
    expect(commandPanel(cancelCase.mounted)?.getAttribute('aria-label')).toBe('Patients commands')

    await cancelCase.mounted.unmount()

    const discardCase = await mountDirtyPatientWorkspace(createPatientFailure('INTERNAL_ERROR'))

    await clickButton(discardCase.mounted, 'Home')
    await clickDialogButton(discardCase.mounted, 'Discard amendment')

    expectWorkspaceHeading(discardCase.mounted, 'Welcome, Admin User')
    expect(commandPanel(discardCase.mounted)?.getAttribute('aria-label')).toBe('Home commands')
    expect(commandButtonByText(discardCase.mounted, 'Dashboard').getAttribute('aria-current')).toBe(
      'page'
    )

    await discardCase.mounted.unmount()

    const saveCase = await mountDirtyPatientWorkspace(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId: '55555555-5555-4555-8555-555555555555',
        patient: shellPatientDetail({
          displayName: 'Protected Changed',
          givenName: 'Protected Changed',
          rowVersion: 2
        })
      })
    )

    await clickButton(saveCase.mounted, 'Screening')
    await clickDialogButton(saveCase.mounted, 'Save amendment')

    expect(saveCase.harness.api.patient.amendDemographics).toHaveBeenCalledOnce()
    expectWorkspaceHeading(saveCase.mounted, 'Patients')
    expect(commandPanel(saveCase.mounted)?.getAttribute('aria-label')).toBe('Screening commands')
    expect(commandButtonByText(saveCase.mounted, 'Patients').getAttribute('aria-current')).toBe(
      'page'
    )

    await saveCase.mounted.unmount()

    const failedSaveCase = await mountDirtyPatientWorkspace(createPatientFailure('INTERNAL_ERROR'))

    await clickButton(failedSaveCase.mounted, 'Reports')
    await clickDialogButton(failedSaveCase.mounted, 'Save amendment')

    expect(failedSaveCase.harness.api.patient.amendDemographics).toHaveBeenCalledOnce()
    expectWorkspaceHeading(failedSaveCase.mounted, 'Patient Search and Management')
    expect(commandPanel(failedSaveCase.mounted)?.getAttribute('aria-label')).toBe(
      'Patients commands'
    )
    expect(text(failedSaveCase.mounted)).toContain(
      'The application could not complete the request.'
    )

    await failedSaveCase.mounted.unmount()
  })

  it('supports roving primary menu keys and F6 focus-zone cycling', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)
    const home = menuButton(mounted, 'Home')

    expect(commandPanel(mounted)?.textContent).toContain('Dashboard')

    home.focus()
    await dispatchKeyboard(home, 'ArrowRight')
    expect(document.activeElement).toBe(menuButton(mounted, 'Patients'))

    await dispatchKeyboard(menuButton(mounted, 'Patients'), 'End')
    expect(document.activeElement).toBe(menuButton(mounted, 'Administration'))

    await dispatchKeyboard(menuButton(mounted, 'Administration'), 'Home')
    expect(document.activeElement).toBe(home)

    await dispatchWindowKeyboard('F6')
    expect(document.activeElement?.textContent).toContain('Dashboard')

    await dispatchWindowKeyboard('F6')
    expect(document.activeElement?.textContent).toContain('Welcome, Admin User')

    await dispatchWindowKeyboard('F6', true)
    expect(document.activeElement?.textContent).toContain('Dashboard')

    await mounted.unmount()
  })

  it('cycles F6 from session controls, all contextual commands, and a closed panel', async () => {
    const mounted = await mountApp(createAppApi(activeSession(1)).api)

    await clickButton(mounted, 'Patients')

    const commands = commandButtons(mounted)
    const firstCommand = commands[0]
    const laterCommand = commands[1]

    if (firstCommand === undefined || laterCommand === undefined) {
      throw new Error('Expected at least two contextual commands to be rendered.')
    }

    for (const startingElement of [
      menuButton(mounted, 'Patients'),
      buttonByText(mounted, 'Lock'),
      buttonByText(mounted, 'Sign out')
    ]) {
      startingElement.focus()
      await dispatchWindowKeyboard('F6')
      expect(document.activeElement).toBe(firstCommand)
    }

    for (const startingCommand of [firstCommand, laterCommand]) {
      startingCommand.focus()
      await dispatchWindowKeyboard('F6')
      expect(document.activeElement).toBe(workspaceHeading(mounted))
    }

    workspaceHeading(mounted).focus()
    await dispatchWindowKeyboard('F6', true)
    expect(document.activeElement).toBe(firstCommand)

    await dispatchKeyboard(commandPanel(mounted)!, 'Escape')
    buttonByText(mounted, 'Lock').focus()
    await dispatchWindowKeyboard('F6')
    expect(document.activeElement).toBe(workspaceHeading(mounted))

    await mounted.unmount()
  })

  it('routes patient commands and quick actions to the patient registry workspace', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Patient Search')

    expect(text(mounted)).toContain('Patient Search and Management')
    expect(text(mounted)).toContain('Select a patient to view or update details.')
    expect(text(mounted)).not.toContain('Not available in this build.')
    expect(harness.api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })

    await clickButton(mounted, 'Home')
    await clickButton(mounted, 'Dashboard')

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(menuButton(mounted, 'Home').getAttribute('aria-current')).toBe('page')
    expect(commandPanel(mounted)?.textContent).toContain('Dashboard')

    await clickButton(mounted, 'Find or open patient')

    expect(text(mounted)).toContain('Patient Search and Management')
    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')

    await mounted.unmount()
  })

  it('shows authentication unavailable and clears patient identity when patient IPC is forbidden', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')

    expect(text(mounted)).toContain('Authentication is unavailable.')
    expect(text(mounted)).toContain('Authentication is unavailable from the current window.')
    expect(text(mounted)).not.toContain('Patient Search and Management')
    expect(text(mounted)).not.toContain('Protected Patient')

    await mounted.unmount()
  })

  it.each([
    {
      code: 'AUTH_LOCKED' as const,
      session: lockedSession(2),
      expectedText: 'Session locked.'
    },
    {
      code: 'AUTH_UNAUTHENTICATED' as const,
      session: signedOutSession(2),
      expectedText: 'Sign in to Health Screening.'
    }
  ])('reconciles $code patient failures through the authentication route', async (testCase) => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createPatientFailure(testCase.code) as Awaited<
        ReturnType<HealthScreeningApi['patient']['search']>
      >
    )
    const mounted = await mountApp(harness.api)
    harness.setSessionSilently(testCase.session)

    await clickButton(mounted, 'Patients')

    expect(harness.api.auth.getSession).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain(testCase.expectedText)
    expect(text(mounted)).not.toContain('Patient Search and Management')

    await mounted.unmount()
  })

  it('unmounts the patient workspace and clears selected identity on lock and logout', async () => {
    const lockHarness = createAppApi(activeSession(1))
    lockHarness.api.patient.search.mockResolvedValue(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    lockHarness.api.patient.get.mockResolvedValue(createIpcSuccess(shellPatientDetail()))
    const lockedMounted = await mountApp(lockHarness.api)

    await clickButton(lockedMounted, 'Patients')

    expect(text(lockedMounted)).toContain('Protected Patient')

    await clickButton(lockedMounted, 'Lock')

    expect(text(lockedMounted)).toContain('Session locked.')
    expect(text(lockedMounted)).not.toContain('Protected Patient')

    await lockedMounted.unmount()

    const logoutHarness = createAppApi(activeSession(1))
    logoutHarness.api.patient.search.mockResolvedValue(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    logoutHarness.api.patient.get.mockResolvedValue(createIpcSuccess(shellPatientDetail()))
    const logoutMounted = await mountApp(logoutHarness.api)

    await clickButton(logoutMounted, 'Patients')

    expect(text(logoutMounted)).toContain('Protected Patient')

    await clickButton(logoutMounted, 'Sign out')

    expect(text(logoutMounted)).toContain('Sign in to Health Screening.')
    expect(text(logoutMounted)).not.toContain('Protected Patient')

    await logoutMounted.unmount()
  })

  it('keeps shell route state across active revisions and resets after leaving active', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')

    await emitSession(harness, activeSession(2, { ...baseUser, displayName: 'Updated User' }))

    expect(text(mounted)).toContain('Updated User')
    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(commandPanel(mounted)?.textContent).toContain('Patient Search')

    await emitSession(harness, lockedSession(3))
    expect(text(mounted)).toContain('Session locked.')

    await emitSession(harness, activeSession(4))

    expect(text(mounted)).toContain('Welcome, Admin User')
    expect(commandPanel(mounted)?.textContent).toContain('Dashboard')
    expect(menuButton(mounted, 'Home').getAttribute('aria-current')).toBe('page')

    await mounted.unmount()
  })

  it('preserves registration draft and component identity across ACTIVE session revisions', async () => {
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await openRegistrationWorkspace(mounted)
    await fillRegistrationDraft(mounted, {
      givenName: 'Revision',
      familyName: 'Proof',
      dateOfBirth: '1991-03-04',
      sex: 'FEMALE',
      village: 'Bastos',
      phone: '+237 600 000 111'
    })

    const givenNameInput = patientFieldInput(mounted, 'Given name')

    await emitSession(harness, activeSession(2, { ...baseUser, displayName: 'Updated User' }))

    expect(patientFieldInput(mounted, 'Given name')).toBe(givenNameInput)
    expectRegistrationDraft(mounted, {
      givenName: 'Revision',
      familyName: 'Proof',
      dateOfBirth: '1991-03-04',
      sex: 'FEMALE',
      village: 'Bastos',
      phone: '+237 600 000 111'
    })
    expectWorkspaceHeading(mounted, 'Register New Patient')
    expect(commandPanel(mounted)?.getAttribute('aria-label')).toBe('Patients commands')
    expect(commandButtonByText(mounted, 'Register New Patient').getAttribute('aria-current')).toBe(
      'page'
    )

    await mounted.unmount()
  })

  it('preserves registration draft when recordActivity returns a newer ACTIVE revision', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.auth.recordActivity.mockResolvedValueOnce(
      createIpcSuccess(activeSession(2)) as AuthRecordActivityResult
    )
    const mounted = await mountApp(harness.api)

    await openRegistrationWorkspace(mounted)
    await fillRegistrationDraft(mounted, {
      givenName: 'Activity',
      familyName: 'Reporter',
      dateOfBirth: '1988-07-09',
      sex: 'MALE',
      village: 'Melen',
      phone: '+237 600 000 222'
    })

    const givenNameInput = patientFieldInput(mounted, 'Given name')

    await dispatchKeyboard(givenNameInput, 'A')

    expect(harness.api.auth.recordActivity).toHaveBeenCalledOnce()
    expect(patientFieldInput(mounted, 'Given name')).toBe(givenNameInput)
    expectRegistrationDraft(mounted, {
      givenName: 'Activity',
      familyName: 'Reporter',
      dateOfBirth: '1988-07-09',
      sex: 'MALE',
      village: 'Melen',
      phone: '+237 600 000 222'
    })
    expectWorkspaceHeading(mounted, 'Register New Patient')

    await mounted.unmount()
  })

  it('preserves selected patient details, edit draft, and dirty state across ACTIVE revisions', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    harness.api.patient.get.mockResolvedValueOnce(createIpcSuccess(shellPatientDetail()))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')

    expect(text(mounted)).toContain('Protected Patient')

    await clickButton(mounted, 'Amend demographics')
    await changeInput(patientFieldInput(mounted, 'Village'), 'Revision Village')
    await changeSelect(patientFieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await emitSession(harness, activeSession(2))

    expectWorkspaceHeading(mounted, 'Patient Search and Management')
    expect(text(mounted)).toContain('PT-000001')
    expect(text(mounted)).toContain('Draft amendment')
    expect(patientFieldInput(mounted, 'Village').value).toBe('Revision Village')

    await mounted.unmount()
  })

  it('preserves patient search query and results across ACTIVE revisions', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
      )
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await changeInput(registrySearchInput(mounted), 'Protected')
    await clickButtonExact(mounted, 'Search')

    expect(text(mounted)).toContain('Protected Patient')

    await emitSession(harness, activeSession(2))

    expect(registrySearchInput(mounted).value).toBe('Protected')
    expect(text(mounted)).toContain('Protected Patient')
    expect(harness.api.patient.search).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })

  it('preserves recent patients across ACTIVE revisions without remounting the recent pane', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.listRecent.mockResolvedValueOnce(
      createIpcSuccess([shellPatientSummary({ displayName: 'Recent Protected' })])
    )
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Recent Patients')

    expect(text(mounted)).toContain('Recent Protected')

    await emitSession(harness, activeSession(2))

    expectWorkspaceHeading(mounted, 'Recent Patients')
    expect(text(mounted)).toContain('Recent Protected')
    expect(harness.api.patient.listRecent).toHaveBeenCalledOnce()

    await mounted.unmount()
  })

  it('preserves duplicate-review candidates and token state across ACTIVE revisions', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.create
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'DUPLICATE_REVIEW_REQUIRED',
          candidates: [
            duplicateCandidate(
              shellPatientSummary({
                id: '22222222-2222-4222-8222-222222222222',
                patientCode: 'PT-000002',
                displayName: 'Possible Match'
              })
            )
          ],
          duplicateReviewToken: 'duplicate-review-token-active-revision'
        })
      )
      .mockResolvedValueOnce(createPatientFailure('VALIDATION_FAILED'))
    const mounted = await mountApp(harness.api)

    await openRegistrationWorkspace(mounted)
    await fillRegistrationDraft(mounted, {
      givenName: 'Possible',
      familyName: 'Duplicate',
      dateOfBirth: '1990-01-02',
      sex: 'FEMALE',
      village: 'Bastos',
      phone: '+237 600 000 333'
    })
    await clickButton(mounted, 'Create patient')

    expect(text(mounted)).toContain('Possible Duplicate Patients')
    expect(text(mounted)).toContain('Possible Match')

    await emitSession(harness, activeSession(2))

    expectWorkspaceHeading(mounted, 'Register New Patient')
    expect(text(mounted)).toContain('Possible Duplicate Patients')
    expect(text(mounted)).toContain('Match reasons: name, date of birth')

    await clickButton(mounted, 'Continue registration despite possible matches')
    await clickDialogButton(mounted, 'Continue registration despite possible matches')

    expect(harness.api.patient.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        duplicateReviewToken: 'duplicate-review-token-active-revision'
      })
    )

    await mounted.unmount()
  })

  it('preserves version-conflict comparison state across ACTIVE revisions', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    harness.api.patient.get.mockResolvedValueOnce(
      createIpcSuccess(shellPatientDetail({ village: 'Original Village' }))
    )
    harness.api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: shellPatientDetail({
          displayName: 'Protected Latest',
          village: 'Latest Village',
          rowVersion: 2
        })
      })
    )
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Amend demographics')
    await changeInput(patientFieldInput(mounted, 'Village'), 'Attempted Village')
    await changeSelect(patientFieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await clickButton(mounted, 'Save amendment')

    expect(text(mounted)).toContain('Patient changed before this amendment was saved')

    await emitSession(harness, activeSession(2))

    expect(text(mounted)).toContain('Patient changed before this amendment was saved')
    expect(text(mounted)).toContain('Latest Village')
    expect(patientFieldInput(mounted, 'Village').value).toBe('Attempted Village')
    expect(text(mounted)).toContain('Draft amendment')

    await mounted.unmount()
  })

  it.each([
    {
      name: 'LOCKED',
      session: lockedSession(2),
      expectedText: 'Session locked.'
    },
    {
      name: 'SIGNED_OUT',
      session: signedOutSession(2),
      expectedText: 'Sign in to Health Screening.'
    },
    {
      name: 'PASSWORD_CHANGE_REQUIRED',
      session: passwordChangeRequiredSession(2),
      expectedText: 'Change required password.'
    }
  ])('clears volatile patient state when the session becomes $name', async (testCase) => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    harness.api.patient.get.mockResolvedValueOnce(createIpcSuccess(shellPatientDetail()))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Register New Patient')
    await changeInput(patientFieldInput(mounted, 'Given name'), 'Volatile Draft')

    await emitSession(harness, testCase.session)

    expect(text(mounted)).toContain(testCase.expectedText)
    expect(text(mounted)).not.toContain('Protected Patient')
    expect(mounted.container.querySelector('.patient-registration')).toBeNull()
    expect(mounted.container.querySelector('.patient-detail-pane')).toBeNull()

    await mounted.unmount()
  })

  it('clears patient state when the authenticated user identity changes', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    harness.api.patient.get.mockResolvedValueOnce(createIpcSuccess(shellPatientDetail()))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')

    expect(text(mounted)).toContain('Protected Patient')

    await emitSession(
      harness,
      activeSession(2, {
        ...baseUser,
        username: 'Other.User',
        displayName: 'Other User'
      })
    )

    expect(text(mounted)).toContain('Welcome, Other User')
    expect(text(mounted)).not.toContain('Protected Patient')
    expectWorkspaceHeading(mounted, 'Welcome, Other User')

    await mounted.unmount()
  })

  it('clears patient identity and registration draft when IPC_FORBIDDEN occurs', async () => {
    const harness = createAppApi(activeSession(1))
    harness.api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    harness.api.patient.get.mockResolvedValueOnce(createIpcSuccess(shellPatientDetail()))
    harness.api.patient.create.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Register New Patient')
    await changeInput(patientFieldInput(mounted, 'Given name'), 'Forbidden Draft')
    await changeInput(patientFieldInput(mounted, 'Date of birth'), '1990-01-02')
    await clickButton(mounted, 'Create patient')

    expect(text(mounted)).toContain('Authentication is unavailable.')
    expect(text(mounted)).not.toContain('Protected Patient')
    expect(mounted.container.querySelector('.patient-registration')).toBeNull()
    expect(mounted.container.querySelector('.patient-detail-pane')).toBeNull()

    await mounted.unmount()
  })

  it('preserves one active-shell F6 listener across ACTIVE revisions and removes it on unmount', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)
    const keydownListenerCount = countWindowListenerCalls(addEventListenerSpy, 'keydown')

    expect(keydownListenerCount).toBeGreaterThan(0)

    await emitSession(harness, activeSession(2, { ...baseUser, displayName: 'Updated User' }))

    expect(countWindowListenerCalls(addEventListenerSpy, 'keydown')).toBe(keydownListenerCount)

    await mounted.unmount()

    expect(countWindowListenerCalls(removeEventListenerSpy, 'keydown')).toBe(keydownListenerCount)
  })

  it('does not use browser persistence, URL routing, network APIs, or extra preload calls during shell navigation', async () => {
    const storagePrototype = Object.getPrototypeOf(window.localStorage) as Storage
    const getItemSpy = vi.spyOn(storagePrototype, 'getItem')
    const setItemSpy = vi.spyOn(storagePrototype, 'setItem')
    const removeItemSpy = vi.spyOn(storagePrototype, 'removeItem')
    const fetchSpy = vi.fn()
    const xhrSpy = vi.fn()
    const webSocketSpy = vi.fn()
    const indexedOpenSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('XMLHttpRequest', xhrSpy)
    vi.stubGlobal('WebSocket', webSocketSpy)
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open: indexedOpenSpy }
    })

    const harness = createAppApi(activeSession(1))
    const mounted = await mountApp(harness.api)

    await clickButton(mounted, 'Patients')
    await clickButton(mounted, 'Patient Search')
    await clickButton(mounted, 'Home')
    await clickButton(mounted, 'Dashboard')

    expect(getItemSpy).not.toHaveBeenCalled()
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(removeItemSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
    expect(webSocketSpy).not.toHaveBeenCalled()
    expect(indexedOpenSpy).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(harness.api.app.getInfo).toHaveBeenCalledOnce()
    expect(harness.api.app.getHealth).toHaveBeenCalledOnce()
    expect(harness.api.firstRun.getState).toHaveBeenCalledOnce()
    expect(harness.api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })

    await mounted.unmount()
  })
})

type MockedHealthScreeningApi = HealthScreeningApi & {
  app: {
    getInfo: ReturnType<typeof vi.fn<HealthScreeningApi['app']['getInfo']>>
    getHealth: ReturnType<typeof vi.fn<HealthScreeningApi['app']['getHealth']>>
  }
  firstRun: {
    getState: ReturnType<typeof vi.fn<HealthScreeningApi['firstRun']['getState']>>
    initialize: ReturnType<typeof vi.fn<HealthScreeningApi['firstRun']['initialize']>>
  }
  auth: {
    getSession: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['getSession']>>
    recordActivity: ReturnType<typeof vi.fn<HealthScreeningApi['auth']['recordActivity']>>
  } & HealthScreeningApi['auth']
  patient: {
    search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
    get: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['get']>>
    create: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['create']>>
    amendDemographics: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['amendDemographics']>>
    listDemographicAmendmentHistory: ReturnType<
      typeof vi.fn<HealthScreeningApi['patient']['listDemographicAmendmentHistory']>
    >
    recordAcknowledgment: ReturnType<
      typeof vi.fn<HealthScreeningApi['patient']['recordAcknowledgment']>
    >
    listAcknowledgmentHistory: ReturnType<
      typeof vi.fn<HealthScreeningApi['patient']['listAcknowledgmentHistory']>
    >
    listRecent: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['listRecent']>>
    findDuplicates: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['findDuplicates']>>
    markNotDuplicate: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['markNotDuplicate']>>
  } & HealthScreeningApi['patient']
  screeningSessions: {
    getWorkspaceContext: ReturnType<
      typeof vi.fn<HealthScreeningApi['screeningSessions']['getWorkspaceContext']>
    >
    ensureCurrent: ReturnType<
      typeof vi.fn<HealthScreeningApi['screeningSessions']['ensureCurrent']>
    >
    create: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['create']>>
    close: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['close']>>
    reopen: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['reopen']>>
    getById: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['getById']>>
    list: ReturnType<typeof vi.fn<HealthScreeningApi['screeningSessions']['list']>>
  } & HealthScreeningApi['screeningSessions']
  screeningEncounters: {
    start: ReturnType<typeof vi.fn<HealthScreeningApi['screeningEncounters']['start']>>
  } & HealthScreeningApi['screeningEncounters']
}

interface AppApiHarness {
  readonly api: MockedHealthScreeningApi
  setSessionSilently(session: PublicAuthenticationSession): void
  emitSession(session: PublicAuthenticationSession): void
}

interface MountedApp {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

interface RegistrationDraftValues {
  readonly givenName: string
  readonly familyName: string
  readonly dateOfBirth: string
  readonly sex: string
  readonly village: string
  readonly phone: string
}

function createAppApi(initialSession: PublicAuthenticationSession): AppApiHarness {
  let currentSession = initialSession
  const listeners = new Set<AuthenticationSessionChangedListener>()

  const api = {
    app: {
      getInfo: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            applicationName: 'Health Screening Offline Desktop',
            applicationVersion: '1.0.0',
            platform: 'win32',
            architecture: 'x64',
            packaged: false
          })
        )
      ),
      getHealth: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'ready',
            ipc: 'available',
            database: 'ready',
            clinicalFeatures: 'not-implemented'
          })
        )
      )
    },
    firstRun: {
      getState: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'INITIALIZED',
            deploymentName: 'Local Deployment',
            timeZone: 'Africa/Douala'
          }) as FirstRunGetStateResult
        )
      ),
      initialize: vi.fn()
    },
    auth: {
      getSession: vi.fn(() =>
        Promise.resolve(createIpcSuccess(currentSession) as AuthGetSessionResult)
      ),
      login: vi.fn(),
      changeRequiredPassword: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(() => Promise.resolve(createIpcSuccess(lockedSession(99)) as AuthLockResult)),
      logout: vi.fn(() =>
        Promise.resolve(createIpcSuccess(signedOutSession(99)) as AuthLogoutResult)
      ),
      recordActivity: vi.fn(() =>
        Promise.resolve(createIpcSuccess(activeSession(100)) as AuthRecordActivityResult)
      ),
      onSessionChanged: vi.fn((listener: AuthenticationSessionChangedListener) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      })
    },
    patient: {
      search: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            items: [],
            page: 1,
            pageSize: 25,
            total: 0
          })
        )
      ),
      get: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      create: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      amendDemographics: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      listDemographicAmendmentHistory: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      ),
      recordAcknowledgment: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      listAcknowledgmentHistory: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      ),
      listRecent: vi.fn(() => Promise.resolve(createIpcSuccess([]))),
      findDuplicates: vi.fn(() => Promise.resolve(createIpcSuccess({ candidates: [], pairs: [] }))),
      markNotDuplicate: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE')))
    },
    screeningSessions: {
      getWorkspaceContext: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            deploymentLocalDate: '2026-08-06',
            activeLocations: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Bastos Hall' }]
          })
        )
      ),
      ensureCurrent: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'RESOLVED',
            session: {
              id: '99999999-9999-4999-8999-999999999999',
              locationId: '77777777-7777-4777-8777-777777777777',
              protocolVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              sessionDate: '2026-08-06',
              status: 'OPEN',
              notes: null,
              openedAt: '2026-08-06T08:15:00.000Z',
              closedAt: null,
              createdAt: '2026-08-06T08:15:00.000Z',
              rowVersion: 1
            },
            location: { id: '77777777-7777-4777-8777-777777777777', name: 'Bastos Hall' }
          })
        )
      ),
      create: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      close: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      reopen: vi.fn(() => Promise.resolve(createScreeningSessionFailure('IPC_UNAVAILABLE'))),
      getById: vi.fn(() => Promise.resolve(createIpcSuccess({ status: 'NOT_FOUND' }))),
      list: vi.fn(() =>
        Promise.resolve(
          createIpcSuccess({
            status: 'LISTED',
            items: [],
            page: 1,
            pageSize: 25,
            total: 0
          })
        )
      )
    },
    screeningEncounters: {
      start: vi.fn((request) =>
        Promise.resolve(
          createIpcSuccess({
            status: 'STARTED',
            encounter: shellEncounterSummary({
              patientId: request.patientId,
              screeningSessionId: request.screeningSessionId
            })
          })
        )
      )
    }
  } as unknown as MockedHealthScreeningApi

  return {
    api,
    setSessionSilently(session: PublicAuthenticationSession): void {
      currentSession = session
    },
    emitSession(session: PublicAuthenticationSession): void {
      currentSession = session

      for (const listener of Array.from(listeners)) {
        listener(session)
      }
    }
  }
}

async function mountApp(api: HealthScreeningApi): Promise<MountedApp> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(App, { api }))
    await flushPromises()
  })
  await flushReact()

  return {
    container,
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

async function mountShell({
  operationError
}: {
  readonly operationError: string | null
}): Promise<MountedApp> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      createElement(ApplicationShell, {
        api: createAppApi(activeSession(1)).api,
        context: shellContext,
        user: shellUser,
        busy: false,
        operationError,
        alertRef: { current: null },
        onLock: vi.fn(),
        onLogout: vi.fn(),
        onProtectedWorkspaceAuthenticationFailure: vi.fn()
      })
    )
    await flushPromises()
  })
  await flushReact()

  return {
    container,
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

async function clickButton(mounted: MountedApp, label: string): Promise<void> {
  const button = Array.from(mounted.container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label)
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function clickButtonExact(mounted: MountedApp, label: string): Promise<void> {
  const button = Array.from(mounted.container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function dispatchKeyboard(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function dispatchWindowKeyboard(key: string, shiftKey = false): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
    await flushPromises()
  })
  await flushReact()
}

async function emitSession(
  harness: AppApiHarness,
  session: PublicAuthenticationSession
): Promise<void> {
  await act(async () => {
    harness.emitSession(session)
    await flushPromises()
  })
  await flushReact()
}

async function mountDirtyPatientWorkspace(
  amendmentResult: Awaited<ReturnType<HealthScreeningApi['patient']['amendDemographics']>>
): Promise<{ readonly harness: AppApiHarness; readonly mounted: MountedApp }> {
  const harness = createAppApi(activeSession(1))
  harness.api.patient.search.mockResolvedValue(
    createIpcSuccess({ items: [shellPatientSummary()], page: 1, pageSize: 25, total: 1 })
  )
  harness.api.patient.get.mockResolvedValue(createIpcSuccess(shellPatientDetail()))
  harness.api.patient.amendDemographics.mockResolvedValue(amendmentResult)
  const mounted = await mountApp(harness.api)

  await clickButton(mounted, 'Patients')
  await clickButton(mounted, 'Amend demographics')
  await changeInput(patientFieldInput(mounted, 'Given name'), 'Protected Changed')
  await changeSelect(patientFieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')

  return { harness, mounted }
}

function primaryMenuLabels(mounted: MountedApp): string[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Primary application navigation"] button'
    )
  ).map((button) => button.textContent?.trim() ?? '')
}

function menuButton(mounted: MountedApp, label: string): HTMLButtonElement {
  const button = Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Primary application navigation"] button'
    )
  ).find((candidate) => candidate.textContent?.trim() === label)

  if (button === undefined) {
    throw new Error(`Expected primary menu ${label} to be rendered.`)
  }

  return button
}

function commandPanel(mounted: MountedApp): HTMLElement | null {
  return mounted.container.querySelector('#application-command-panel')
}

function commandButtons(mounted: MountedApp): HTMLButtonElement[] {
  return Array.from(commandPanel(mounted)?.querySelectorAll<HTMLButtonElement>('button') ?? [])
}

function commandButtonByText(mounted: MountedApp, label: string): HTMLButtonElement {
  const button = commandButtons(mounted).find(
    (candidate) => candidate.textContent?.trim() === label
  )

  if (button === undefined) {
    throw new Error(`Expected command button ${label} to be rendered.`)
  }

  return button
}

async function clickDialogButton(mounted: MountedApp, label: string): Promise<void> {
  const button = dialogButtonByText(mounted, label)

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

function dialogButtonByText(mounted: MountedApp, label: string): HTMLButtonElement {
  const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]')
  const button = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
    (candidate) => candidate.textContent?.trim() === label
  )

  if (button === undefined) {
    throw new Error(`Expected dialog button ${label} to be rendered.`)
  }

  return button
}

function expectCommandPanelLabels(mounted: MountedApp, labels: string[]): void {
  expect(commandButtons(mounted).map((button) => button.textContent?.trim() ?? '')).toEqual(labels)
}

function summaryCards(mounted: MountedApp): HTMLElement[] {
  return Array.from(mounted.container.querySelectorAll<HTMLElement>('.dashboard-summary-card'))
}

function patientSearchInput(mounted: MountedApp): HTMLInputElement {
  const input = mounted.container.querySelector<HTMLInputElement>('#dashboard-patient-search')

  if (input === null) {
    throw new Error('Expected disabled dashboard patient search input to be rendered.')
  }

  return input
}

function registrySearchInput(mounted: MountedApp): HTMLInputElement {
  const input = mounted.container.querySelector<HTMLInputElement>('#patient-registry-search')

  if (input === null) {
    throw new Error('Expected patient registry search input to be rendered.')
  }

  return input
}

function worklistRows(mounted: MountedApp): HTMLTableRowElement[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLTableRowElement>('.dashboard-worklist tbody tr')
  )
}

function buttonByText(mounted: MountedApp, label: string): HTMLButtonElement {
  const button = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
}

function workspaceHeading(mounted: MountedApp): HTMLHeadingElement {
  const heading = mounted.container.querySelector<HTMLHeadingElement>(
    '#application-workspace-heading'
  )

  if (heading === null) {
    throw new Error('Expected application workspace heading to be rendered.')
  }

  return heading
}

function expectWorkspaceHeading(mounted: MountedApp, expected: string): void {
  expect(workspaceHeading(mounted).textContent?.trim()).toBe(expected)
}

function patientFieldInput(mounted: MountedApp, label: string): HTMLInputElement {
  const input = patientFieldControl<HTMLInputElement>(mounted, label, 'input')

  if (input !== null) {
    return input
  }

  throw new Error(`Expected patient field ${label} to be rendered.`)
}

function patientFieldSelect(mounted: MountedApp, label: string): HTMLSelectElement {
  const select = patientFieldControl<HTMLSelectElement>(mounted, label, 'select')

  if (select !== null) {
    return select
  }

  throw new Error(`Expected patient select field ${label} to be rendered.`)
}

function patientFieldControl<TElement extends HTMLElement>(
  mounted: MountedApp,
  label: string,
  selector: string
): TElement | null {
  for (const candidate of Array.from(
    mounted.container.querySelectorAll<HTMLLabelElement>('label')
  )) {
    if (candidate.querySelector('span')?.textContent?.trim() === label) {
      return candidate.querySelector<TElement>(selector)
    }
  }

  return null
}

async function openRegistrationWorkspace(mounted: MountedApp): Promise<void> {
  await clickButton(mounted, 'Patients')
  await clickButton(mounted, 'Register New Patient')

  expectWorkspaceHeading(mounted, 'Register New Patient')
}

async function fillRegistrationDraft(
  mounted: MountedApp,
  values: RegistrationDraftValues
): Promise<void> {
  await changeInput(patientFieldInput(mounted, 'Given name'), values.givenName)
  await changeInput(patientFieldInput(mounted, 'Family name'), values.familyName)
  await changeInput(patientFieldInput(mounted, 'Date of birth'), values.dateOfBirth)
  await changeSelect(patientFieldSelect(mounted, 'Sex'), values.sex)
  await changeInput(patientFieldInput(mounted, 'Village'), values.village)
  await changeInput(patientFieldInput(mounted, 'Phone'), values.phone)
}

function expectRegistrationDraft(mounted: MountedApp, values: RegistrationDraftValues): void {
  expect(patientFieldInput(mounted, 'Given name').value).toBe(values.givenName)
  expect(patientFieldInput(mounted, 'Family name').value).toBe(values.familyName)
  expect(patientFieldInput(mounted, 'Date of birth').value).toBe(values.dateOfBirth)
  expect(patientFieldSelect(mounted, 'Sex').value).toBe(values.sex)
  expect(patientFieldInput(mounted, 'Village').value).toBe(values.village)
  expect(patientFieldInput(mounted, 'Phone').value).toBe(values.phone)
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    valueSetter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

function expectShellSlots(
  mounted: MountedApp,
  expected: { readonly hasAlert: boolean; readonly hasPanel: boolean }
): void {
  const shell = mounted.container.querySelector<HTMLElement>('.application-shell')

  if (shell === null) {
    throw new Error('Expected application shell to be rendered.')
  }

  expect(
    Array.from(shell.children).map((child) => (child as HTMLElement).dataset.shellSlot)
  ).toEqual(['top-bar', 'operation-alert', 'contextual-panel', 'workspace', 'footer'])

  const alertSlot = shell.querySelector<HTMLElement>('[data-shell-slot="operation-alert"]')
  const panelSlot = shell.querySelector<HTMLElement>('[data-shell-slot="contextual-panel"]')
  const workspace = shell.querySelector<HTMLElement>('[data-shell-slot="workspace"]')
  const footer = shell.querySelector<HTMLElement>('[data-shell-slot="footer"]')

  expect(alertSlot?.querySelector('[role="alert"]') !== null).toBe(expected.hasAlert)
  expect(panelSlot?.querySelector('#application-command-panel') !== null).toBe(expected.hasPanel)
  expect(shell.querySelector('[data-shell-slot="patient-tabs"]')).toBeNull()
  expect(workspace?.parentElement).toBe(shell)
  expect(footer?.parentElement).toBe(shell)
}

function countWindowListenerCalls(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  type: string
): number {
  return spy.mock.calls.filter(([eventType]) => eventType === type).length
}

function text(mounted: MountedApp): string {
  return mounted.container.textContent ?? ''
}

function shellPatientSummary(overrides: Partial<PublicPatientSummary> = {}): PublicPatientSummary {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    patientCode: 'PT-000001',
    displayName: 'Protected Patient',
    givenName: 'Protected',
    familyName: 'Patient',
    otherNames: null,
    dateOfBirth: '1990-01-02',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Bastos',
    quarter: 'East',
    phone: '+237 600 000 001',
    status: 'ACTIVE',
    rowVersion: 1,
    updatedAt: futureTimestamp(0),
    ...overrides
  }
}

function shellPatientDetail(overrides: Partial<PublicPatientDetail> = {}): PublicPatientDetail {
  return {
    ...shellPatientSummary(overrides),
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    acknowledgment: {
      status: 'NOT_REQUESTED',
      recordedAt: null,
      recordedByDisplayName: null
    },
    createdAt: futureTimestamp(0),
    createdByDisplayName: 'Admin User',
    updatedByDisplayName: 'Admin User',
    clinicalStatus: 'NOT_AVAILABLE',
    ...overrides
  }
}

function shellEncounterSummary(
  overrides: Partial<PublicScreeningEncounterStartSummary> = {}
): PublicScreeningEncounterStartSummary {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    patientId: '11111111-1111-4111-8111-111111111111',
    screeningSessionId: '99999999-9999-4999-8999-999999999999',
    status: 'DRAFT',
    startedAt: futureTimestamp(0),
    recordVersion: 1,
    ...overrides
  }
}

function duplicateCandidate(patient: PublicPatientSummary): PublicPatientDuplicateCandidate {
  return {
    patient,
    matchedOn: ['name', 'date_of_birth'],
    score: 87,
    status: 'POSSIBLE_DUPLICATE'
  }
}

async function flushReact(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await flushPromises()
    })
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function userWithRole(role: LocalUserRole): PublicAuthenticatedUser {
  return {
    ...baseUser,
    role
  }
}

function activeSession(
  revision: number,
  user: PublicAuthenticatedUser = baseUser
): PublicActiveAuthenticationSession {
  return {
    status: 'ACTIVE',
    user,
    idleExpiresAt: futureTimestamp(15 * 60_000),
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision
  }
}

function lockedSession(revision: number): PublicLockedAuthenticationSession {
  return {
    status: 'LOCKED',
    user: baseUser,
    reason: 'MANUAL',
    absoluteExpiresAt: futureTimestamp(12 * 60 * 60_000),
    revision
  }
}

function passwordChangeRequiredSession(
  revision: number
): PublicPasswordChangeRequiredAuthenticationSession {
  return {
    status: 'PASSWORD_CHANGE_REQUIRED',
    user: baseUser,
    expiresAt: futureTimestamp(15 * 60_000),
    revision
  }
}

function signedOutSession(revision: number): PublicSignedOutAuthenticationSession {
  return {
    status: 'SIGNED_OUT',
    revision
  }
}

function futureTimestamp(offsetMs: number): UtcTimestamp {
  return new Date(Date.now() + offsetMs).toISOString() as UtcTimestamp
}
