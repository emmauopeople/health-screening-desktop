import type { LocalUserRole } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  isCommandVisibleToRole
} from './application-navigation-catalog'

export const dashboardSummaryCards = Object.freeze([
  Object.freeze({
    label: 'Screened today',
    value: '\u2014',
    accent: 'primary',
    support: 'Screening totals require the future encounter data source.'
  }),
  Object.freeze({
    label: 'Draft encounters',
    value: '\u2014',
    accent: 'warning',
    support: 'Draft encounter tracking is planned for the screening workspace.'
  }),
  Object.freeze({
    label: 'Open referrals',
    value: '\u2014',
    accent: 'referral',
    support: 'Referral counts require the future referral workflow data source.'
  }),
  Object.freeze({
    label: 'Pending sync',
    value: '\u2014',
    accent: 'sync',
    support: 'Synchronization status is planned and is not monitored here.'
  }),
  Object.freeze({
    label: 'Last backup',
    value: '\u2014',
    accent: 'success',
    support: 'Backup history is planned and is not available in this build.'
  })
])

const dashboardQuickActions = Object.freeze([
  Object.freeze({
    label: 'Find or open patient',
    support: 'Planned patient search and tab workspace',
    commandId: 'PATIENTS_PATIENT_SEARCH' as const
  }),
  Object.freeze({
    label: 'Start new screening',
    support: 'Open or select today\u2019s session before future encounter entry',
    commandId: 'SCREENING_NEW_SCREENING' as const
  }),
  Object.freeze({
    label: 'Record referral follow-up',
    support: 'Planned referral follow-up workspace',
    commandId: 'REFERRALS_FOLLOW_UP_DUE' as const
  }),
  Object.freeze({
    label: 'Print session summary',
    support: 'Planned session summary output',
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
