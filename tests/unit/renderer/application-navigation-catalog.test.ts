import { describe, expect, it } from 'vitest'

import {
  applicationCommandDefinitions,
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
        [
          'Dashboard',
          'Today\u2019s Session',
          'Quick Patient Search',
          'Open Referrals',
          'Sync Center'
        ]
      ],
      [
        'Patients',
        ['Patient Search', 'Register New Patient', 'Recent Patients', 'Possible Duplicates']
      ],
      [
        'Screening',
        ['Today\u2019s Session', 'New Screening', 'Draft Encounters', 'Session Summary']
      ],
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
      ['Home', ['Dashboard', 'Today\u2019s Session', 'Quick Patient Search', 'Open Referrals']],
      [
        'Patients',
        ['Patient Search', 'Register New Patient', 'Recent Patients', 'Possible Duplicates']
      ],
      [
        'Screening',
        ['Today\u2019s Session', 'New Screening', 'Draft Encounters', 'Session Summary']
      ],
      ['Referrals', ['Referral Worklist', 'Follow-up Due', 'Closed Referrals', 'Print Queue']],
      ['Reports', ['Patient Reports', 'Session Reports', 'Referral Reports', 'Export / Print']]
    ])
    expect(labelsForRole('TRAINED_SCREENER')).toEqual([
      ['Home', ['Dashboard', 'Today\u2019s Session', 'Quick Patient Search']],
      ['Patients', ['Patient Search', 'Register New Patient', 'Recent Patients']],
      ['Screening', ['Today\u2019s Session', 'New Screening', 'Draft Encounters']],
      ['Referrals', ['Referral Worklist']]
    ])
    expect(getVisibleApplicationMenus('UNKNOWN')).toEqual([])
  })

  it('freezes returned catalogs and keeps dashboard as the only available command', () => {
    const adminMenus = getVisibleApplicationMenus('LOCAL_ADMIN')

    expect(Object.isFrozen(applicationCommandDefinitions)).toBe(true)
    expect(Object.isFrozen(applicationCommandDefinitions[0]?.roles)).toBe(true)
    expect(Object.isFrozen(adminMenus)).toBe(true)
    expect(Object.isFrozen(adminMenus[0]?.commands)).toBe(true)
    expect(
      applicationCommandDefinitions
        .filter((definition) => definition.availability === 'AVAILABLE')
        .map((definition) => definition.id)
    ).toEqual(['HOME_DASHBOARD'])
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
