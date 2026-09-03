import type { LocalUserRole } from '@shared/ipc'

import {
  getApplicationCommandDefinition,
  isCommandVisibleToRole
} from './application-navigation-catalog'

export const dashboardSummaryCards = Object.freeze([
  Object.freeze({
    key: 'completedEncounters',
    label: 'Completed encounters',
    accent: 'primary',
    support: 'Completed and amended screening encounters at this location.'
  }),
  Object.freeze({
    key: 'draftEncounters',
    label: 'Draft encounters',
    accent: 'warning',
    support: 'Resumable drafts in the current local screening session.'
  }),
  Object.freeze({
    key: 'openReferrals',
    label: 'Open referrals',
    accent: 'referral',
    support: 'Active referrals at this installation location.'
  }),
  Object.freeze({
    key: 'pendingSync',
    label: 'Pending sync',
    accent: 'sync',
    support: 'Synchronization status is planned and is not monitored here.'
  }),
  Object.freeze({
    key: 'lastBackup',
    label: 'Last backup',
    accent: 'success',
    support: 'Backup history is planned and is not available in this build.'
  })
])

const dashboardQuickActions = Object.freeze([
  Object.freeze({
    label: 'Find or open patient',
    support: 'Search the local patient registry',
    commandId: 'PATIENTS_PATIENT_SEARCH' as const
  }),
  Object.freeze({
    label: 'New Screening',
    support: 'Open the Screening patients workspace',
    commandId: 'SCREENING_NEW_SCREENING' as const
  }),
  Object.freeze({
    label: 'Referrals',
    support: 'Open the referral worklist',
    commandId: 'REFERRALS_REFERRAL_WORKLIST' as const
  }),
  Object.freeze({
    label: 'Manage Encounters',
    support: 'Search and manage screening encounters',
    commandId: 'SCREENING_MANAGE_ENCOUNTERS' as const
  }),
  Object.freeze({
    label: 'Reports',
    support: 'Open screening session reports',
    commandId: 'REPORTS_SESSION_REPORTS' as const
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
