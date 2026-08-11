import type { LocalUserRole } from '@shared/ipc'

import type {
  ApplicationCommandDefinition,
  ApplicationCommandId,
  PrimaryApplicationMenu
} from './application-shell-types'

const allRoles: readonly LocalUserRole[] = Object.freeze([
  'LOCAL_ADMIN',
  'NURSE',
  'TRAINED_SCREENER'
])
const nurseAndAdminRoles: readonly LocalUserRole[] = Object.freeze(['LOCAL_ADMIN', 'NURSE'])
const adminOnlyRoles: readonly LocalUserRole[] = Object.freeze(['LOCAL_ADMIN'])

export const primaryApplicationMenus: readonly PrimaryApplicationMenu[] = Object.freeze([
  'HOME',
  'PATIENTS',
  'SCREENING',
  'REFERRALS',
  'REPORTS',
  'ADMINISTRATION'
])

export const primaryApplicationMenuLabels: Readonly<Record<PrimaryApplicationMenu, string>> =
  Object.freeze({
    HOME: 'Home',
    PATIENTS: 'Patients',
    SCREENING: 'Screening',
    REFERRALS: 'Referrals',
    REPORTS: 'Reports',
    ADMINISTRATION: 'Administration'
  })

export const defaultApplicationCommands: Readonly<
  Record<PrimaryApplicationMenu, ApplicationCommandId>
> = Object.freeze({
  HOME: 'HOME_DASHBOARD',
  PATIENTS: 'PATIENTS_PATIENT_SEARCH',
  SCREENING: 'SCREENING_TODAYS_SESSION',
  REFERRALS: 'REFERRALS_REFERRAL_WORKLIST',
  REPORTS: 'REPORTS_PATIENT_REPORTS',
  ADMINISTRATION: 'ADMINISTRATION_USERS'
})

const plannedOwners = Object.freeze({
  hsd025: 'HSD-025 patient registry management',
  session: 'Future session workspace',
  screening: 'Future screening workflow package',
  referrals: 'Future referral workflow package',
  reporting: 'Future reporting package',
  sync: 'Future synchronization package',
  administration: 'Future administration package'
})

const commandDefinitions = [
  command('HOME_DASHBOARD', 'HOME', 'Dashboard', allRoles, 'AVAILABLE', null),
  command(
    'HOME_TODAYS_SESSION',
    'HOME',
    'Patient Screening',
    allRoles,
    'AVAILABLE',
    plannedOwners.session
  ),
  command(
    'HOME_QUICK_PATIENT_SEARCH',
    'HOME',
    'Quick Patient Search',
    allRoles,
    'AVAILABLE',
    plannedOwners.hsd025
  ),
  command(
    'HOME_OPEN_REFERRALS',
    'HOME',
    'Open Referrals',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.referrals
  ),
  command('HOME_SYNC_CENTER', 'HOME', 'Sync Center', adminOnlyRoles, 'PLANNED', plannedOwners.sync),
  command(
    'PATIENTS_PATIENT_SEARCH',
    'PATIENTS',
    'Patient Search',
    allRoles,
    'AVAILABLE',
    plannedOwners.hsd025
  ),
  command(
    'PATIENTS_REGISTER_NEW_PATIENT',
    'PATIENTS',
    'Register New Patient',
    allRoles,
    'AVAILABLE',
    plannedOwners.hsd025
  ),
  command(
    'PATIENTS_RECENT_PATIENTS',
    'PATIENTS',
    'Recent Patients',
    allRoles,
    'AVAILABLE',
    plannedOwners.hsd025
  ),
  command(
    'PATIENTS_POSSIBLE_DUPLICATES',
    'PATIENTS',
    'Possible Duplicates',
    allRoles,
    'AVAILABLE',
    plannedOwners.hsd025
  ),
  command(
    'SCREENING_TODAYS_SESSION',
    'SCREENING',
    'Patients',
    allRoles,
    'AVAILABLE',
    plannedOwners.session
  ),
  command(
    'SCREENING_NEW_SCREENING',
    'SCREENING',
    'New Screening',
    allRoles,
    'AVAILABLE',
    plannedOwners.screening
  ),
  command(
    'SCREENING_DRAFT_ENCOUNTERS',
    'SCREENING',
    'Draft Encounters',
    allRoles,
    'PLANNED',
    plannedOwners.screening
  ),
  command(
    'SCREENING_SESSION_SUMMARY',
    'SCREENING',
    'Session Summary',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REFERRALS_REFERRAL_WORKLIST',
    'REFERRALS',
    'Referral Worklist',
    allRoles,
    'PLANNED',
    plannedOwners.referrals
  ),
  command(
    'REFERRALS_FOLLOW_UP_DUE',
    'REFERRALS',
    'Follow-up Due',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.referrals
  ),
  command(
    'REFERRALS_CLOSED_REFERRALS',
    'REFERRALS',
    'Closed Referrals',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.referrals
  ),
  command(
    'REFERRALS_PRINT_QUEUE',
    'REFERRALS',
    'Print Queue',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REPORTS_PATIENT_REPORTS',
    'REPORTS',
    'Patient Reports',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REPORTS_SESSION_REPORTS',
    'REPORTS',
    'Session Reports',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REPORTS_REFERRAL_REPORTS',
    'REPORTS',
    'Referral Reports',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REPORTS_AUDIT_REPORTS',
    'REPORTS',
    'Audit Reports',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'REPORTS_EXPORT_PRINT',
    'REPORTS',
    'Export / Print',
    nurseAndAdminRoles,
    'PLANNED',
    plannedOwners.reporting
  ),
  command(
    'ADMINISTRATION_USERS',
    'ADMINISTRATION',
    'Users',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.administration
  ),
  command(
    'ADMINISTRATION_LOCATIONS',
    'ADMINISTRATION',
    'Locations',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.administration
  ),
  command(
    'ADMINISTRATION_PROTOCOLS',
    'ADMINISTRATION',
    'Protocols',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.administration
  ),
  command(
    'ADMINISTRATION_SYNC_CENTER',
    'ADMINISTRATION',
    'Sync Center',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.sync
  ),
  command(
    'ADMINISTRATION_BACKUP_RESTORE',
    'ADMINISTRATION',
    'Backup / Restore',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.administration
  ),
  command(
    'ADMINISTRATION_AUDIT',
    'ADMINISTRATION',
    'Audit',
    adminOnlyRoles,
    'PLANNED',
    plannedOwners.administration
  )
] as const

export const applicationCommandDefinitions: readonly ApplicationCommandDefinition[] = Object.freeze(
  commandDefinitions.map(freezeCommand)
)

export interface ApplicationMenuNavigationDefinition {
  readonly id: PrimaryApplicationMenu
  readonly label: string
  readonly commands: readonly ApplicationCommandDefinition[]
}

export function getVisibleApplicationMenus(
  role: unknown
): readonly ApplicationMenuNavigationDefinition[] {
  if (!isLocalUserRole(role)) {
    return Object.freeze([])
  }

  return Object.freeze(
    primaryApplicationMenus
      .map((menu) => {
        const commands = getVisibleApplicationCommands(role, menu)

        if (commands.length === 0) {
          return null
        }

        return Object.freeze({
          id: menu,
          label: primaryApplicationMenuLabels[menu],
          commands
        })
      })
      .filter((menu): menu is ApplicationMenuNavigationDefinition => menu !== null)
  )
}

export function getVisibleApplicationCommands(
  role: unknown,
  menu: PrimaryApplicationMenu
): readonly ApplicationCommandDefinition[] {
  if (!isLocalUserRole(role)) {
    return Object.freeze([])
  }

  return Object.freeze(
    applicationCommandDefinitions.filter(
      (definition) => definition.menu === menu && isCommandVisibleToRole(definition, role)
    )
  )
}

export function getApplicationCommandDefinition(
  commandId: ApplicationCommandId
): ApplicationCommandDefinition | null {
  return applicationCommandDefinitions.find((definition) => definition.id === commandId) ?? null
}

export function getDefaultApplicationCommand(
  menu: PrimaryApplicationMenu,
  role: unknown
): ApplicationCommandId | null {
  if (!isLocalUserRole(role)) {
    return null
  }

  const commandId = defaultApplicationCommands[menu]
  const definition = getApplicationCommandDefinition(commandId)

  if (
    definition === null ||
    definition.menu !== menu ||
    !isCommandVisibleToRole(definition, role)
  ) {
    return null
  }

  return commandId
}

export function isApplicationCommandId(value: unknown): value is ApplicationCommandId {
  return (
    typeof value === 'string' &&
    applicationCommandDefinitions.some((definition) => definition.id === value)
  )
}

export function isCommandVisibleToRole(
  definition: ApplicationCommandDefinition,
  role: LocalUserRole
): boolean {
  return definition.roles.includes(role)
}

export function isLocalUserRole(role: unknown): role is LocalUserRole {
  return role === 'LOCAL_ADMIN' || role === 'NURSE' || role === 'TRAINED_SCREENER'
}

function command(
  id: ApplicationCommandId,
  menu: PrimaryApplicationMenu,
  label: string,
  roles: readonly LocalUserRole[],
  availability: ApplicationCommandDefinition['availability'],
  plannedOwner: string | null
): ApplicationCommandDefinition {
  return {
    id,
    menu,
    label,
    roles,
    availability,
    plannedOwner
  }
}

function freezeCommand(definition: ApplicationCommandDefinition): ApplicationCommandDefinition {
  return Object.freeze({
    ...definition,
    roles: Object.freeze([...definition.roles])
  })
}
