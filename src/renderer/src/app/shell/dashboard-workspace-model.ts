import type { LocalUserRole } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  isCommandVisibleToRole
} from './application-navigation-catalog'

export const dashboardSummaryCards = Object.freeze([
  Object.freeze({
    label: 'Screened today',
    value: '\u2014',
    support: 'Screening totals require the future encounter data source.'
  }),
  Object.freeze({
    label: 'Draft encounters',
    value: '\u2014',
    support: 'Draft encounter tracking is planned for the screening workspace.'
  }),
  Object.freeze({
    label: 'Open referrals',
    value: '\u2014',
    support: 'Referral counts require the future referral workflow data source.'
  }),
  Object.freeze({
    label: 'Pending sync',
    value: '\u2014',
    support: 'Synchronization status is planned and is not monitored here.'
  }),
  Object.freeze({
    label: 'Last backup',
    value: '\u2014',
    support: 'Backup history is planned and is not available in this build.'
  })
])

const dashboardQuickActions = Object.freeze([
  Object.freeze({
    label: 'Find or open patient',
    commandId: 'PATIENTS_PATIENT_SEARCH' as const
  }),
  Object.freeze({
    label: 'Start new screening',
    commandId: 'SCREENING_NEW_SCREENING' as const
  }),
  Object.freeze({
    label: 'Record referral follow-up',
    commandId: 'REFERRALS_FOLLOW_UP_DUE' as const
  }),
  Object.freeze({
    label: 'Print session summary',
    commandId: 'SCREENING_SESSION_SUMMARY' as const
  })
])

export function getVisibleDashboardQuickActions(
  role: LocalUserRole
): readonly (typeof dashboardQuickActions)[number][] {
  return Object.freeze(
    dashboardQuickActions.filter((action) => {
      const definition = getApplicationCommandDefinition(action.commandId)

      return definition !== null && isCommandVisibleToRole(definition, role)
    })
  )
}
