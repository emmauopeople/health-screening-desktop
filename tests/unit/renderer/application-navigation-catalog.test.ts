import { describe, expect, it } from 'vitest'

import {
  applicationCommandDefinitions,
  defaultApplicationCommands,
  getDefaultApplicationCommand,
  getApplicationCommandDefinition,
  getVisibleApplicationMenus,
  primaryApplicationMenus
} from '../../../src/renderer/src/app/shell/application-navigation-catalog'

describe('application navigation catalog', () => {
  it('matches the approved primary menu order and command labels', () => {
    expect(primaryApplicationMenus).toEqual([
      'HOME',
      'PATIENTS',
      'SCREENING',
      'REFERRALS',
      'REPORTS',
      'ADMINISTRATION'
    ])

    expect(labelsForRole('LOCAL_ADMIN')).toEqual([
      [
        'Home',
        ['Dashboard', 'Patient Screening', 'Quick Patient Search', 'Open Referrals', 'Sync Center']
      ],
      [
        'Patients',
        ['Patient Search', 'Register New Patient', 'Recent Patients', 'Possible Duplicates']
      ],
      ['Screening', ['Patients', 'New Screening', 'Draft Encounters', 'Session Summary']],
      ['Referrals', ['Referral Worklist', 'Follow-up Due', 'Closed Referrals', 'Print Queue']],
      [
        'Reports',
        [
          'Patient Reports',
          'Session Reports',
          'Referral Reports',
          'Audit Reports',
          'Export / Print'
        ]
      ],
      [
        'Administration',
        ['Users', 'Locations', 'Protocols', 'Sync Center', 'Backup / Restore', 'Audit']
      ]
    ])
  })

  it('filters menus and commands exactly by local role', () => {
    expect(labelsForRole('NURSE')).toEqual([
      ['Home', ['Dashboard', 'Patient Screening', 'Quick Patient Search', 'Open Referrals']],
      [
        'Patients',
        ['Patient Search', 'Register New Patient', 'Recent Patients', 'Possible Duplicates']
      ],
      ['Screening', ['Patients', 'New Screening', 'Draft Encounters', 'Session Summary']],
      ['Referrals', ['Referral Worklist', 'Follow-up Due', 'Closed Referrals', 'Print Queue']],
      ['Reports', ['Patient Reports', 'Session Reports', 'Referral Reports', 'Export / Print']]
    ])
    expect(labelsForRole('TRAINED_SCREENER')).toEqual([
      ['Home', ['Dashboard', 'Patient Screening', 'Quick Patient Search']],
      [
        'Patients',
        ['Patient Search', 'Register New Patient', 'Recent Patients', 'Possible Duplicates']
      ],
      ['Screening', ['Patients', 'New Screening', 'Draft Encounters']],
      ['Referrals', ['Referral Worklist']]
    ])
    expect(getVisibleApplicationMenus('UNKNOWN')).toEqual([])
  })

  it('freezes returned catalogs and exposes patient registry commands as available', () => {
    const adminMenus = getVisibleApplicationMenus('LOCAL_ADMIN')

    expect(Object.isFrozen(applicationCommandDefinitions)).toBe(true)
    expect(Object.isFrozen(defaultApplicationCommands)).toBe(true)
    expect(Object.isFrozen(applicationCommandDefinitions[0]?.roles)).toBe(true)
    expect(Object.isFrozen(adminMenus)).toBe(true)
    expect(Object.isFrozen(adminMenus[0]?.commands)).toBe(true)
    expect(
      applicationCommandDefinitions
        .filter((definition) => definition.availability === 'AVAILABLE')
        .map((definition) => definition.id)
    ).toEqual([
      'HOME_DASHBOARD',
      'HOME_TODAYS_SESSION',
      'HOME_QUICK_PATIENT_SEARCH',
      'PATIENTS_PATIENT_SEARCH',
      'PATIENTS_REGISTER_NEW_PATIENT',
      'PATIENTS_RECENT_PATIENTS',
      'PATIENTS_POSSIBLE_DUPLICATES',
      'SCREENING_TODAYS_SESSION',
      'SCREENING_NEW_SCREENING'
    ])
  })

  it('defines explicit default commands and validates them by role', () => {
    expect(defaultApplicationCommands).toEqual({
      HOME: 'HOME_DASHBOARD',
      PATIENTS: 'PATIENTS_PATIENT_SEARCH',
      SCREENING: 'SCREENING_TODAYS_SESSION',
      REFERRALS: 'REFERRALS_REFERRAL_WORKLIST',
      REPORTS: 'REPORTS_PATIENT_REPORTS',
      ADMINISTRATION: 'ADMINISTRATION_USERS'
    })

    for (const menu of primaryApplicationMenus) {
      const defaultCommandId = getDefaultApplicationCommand(menu, 'LOCAL_ADMIN')
      const definition =
        defaultCommandId === null ? null : getApplicationCommandDefinition(defaultCommandId)

      expect(defaultCommandId).toBe(defaultApplicationCommands[menu])
      expect(definition?.menu).toBe(menu)
    }

    expect(getDefaultApplicationCommand('REPORTS', 'NURSE')).toBe('REPORTS_PATIENT_REPORTS')
    expect(getDefaultApplicationCommand('ADMINISTRATION', 'NURSE')).toBeNull()
    expect(getDefaultApplicationCommand('REPORTS', 'TRAINED_SCREENER')).toBeNull()
    expect(getDefaultApplicationCommand('HOME', 'UNKNOWN')).toBeNull()
  })
})

function labelsForRole(
  role: Parameters<typeof getVisibleApplicationMenus>[0]
): Array<[string, string[]]> {
  return getVisibleApplicationMenus(role).map((menu) => [
    menu.label,
    menu.commands.map((command) => command.label)
  ])
}
