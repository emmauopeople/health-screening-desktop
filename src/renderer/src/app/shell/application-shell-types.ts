import type { LocalUserRole } from '@shared/ipc'

export type PrimaryApplicationMenu =
  'HOME' | 'PATIENTS' | 'SCREENING' | 'REFERRALS' | 'REPORTS' | 'ADMINISTRATION'

export type ApplicationCommandAvailability = 'AVAILABLE' | 'PLANNED'

export type ApplicationCommandId =
  | 'HOME_DASHBOARD'
  | 'HOME_TODAYS_SESSION'
  | 'HOME_QUICK_PATIENT_SEARCH'
  | 'HOME_OPEN_REFERRALS'
  | 'HOME_SYNC_CENTER'
  | 'PATIENTS_PATIENT_SEARCH'
  | 'PATIENTS_REGISTER_NEW_PATIENT'
  | 'PATIENTS_RECENT_PATIENTS'
  | 'PATIENTS_POSSIBLE_DUPLICATES'
  | 'SCREENING_TODAYS_SESSION'
  | 'SCREENING_NEW_SCREENING'
  | 'SCREENING_DRAFT_ENCOUNTERS'
  | 'SCREENING_MANAGE_ENCOUNTERS'
  | 'SCREENING_SESSION_SUMMARY'
  | 'REFERRALS_REFERRAL_WORKLIST'
  | 'REFERRALS_FOLLOW_UP_DUE'
  | 'REFERRALS_CLOSED_REFERRALS'
  | 'REFERRALS_PRINT_QUEUE'
  | 'REPORTS_PATIENT_REPORTS'
  | 'REPORTS_SESSION_REPORTS'
  | 'REPORTS_REFERRAL_REPORTS'
  | 'REPORTS_AUDIT_REPORTS'
  | 'REPORTS_EXPORT_PRINT'
  | 'ADMINISTRATION_USERS'
  | 'ADMINISTRATION_LOCATIONS'
  | 'ADMINISTRATION_PROTOCOLS'
  | 'ADMINISTRATION_SYNC_CENTER'
  | 'ADMINISTRATION_BACKUP_RESTORE'
  | 'ADMINISTRATION_AUDIT'

export interface ApplicationCommandDefinition {
  readonly id: ApplicationCommandId
  readonly menu: PrimaryApplicationMenu
  readonly label: string
  readonly roles: readonly LocalUserRole[]
  readonly availability: ApplicationCommandAvailability
  readonly plannedOwner: string | null
}

export type ApplicationWorkspaceRoute =
  | { readonly status: 'DASHBOARD'; readonly commandId: 'HOME_DASHBOARD' }
  | {
      readonly status: 'PATIENTS'
      readonly commandId:
        | 'PATIENTS_PATIENT_SEARCH'
        | 'PATIENTS_REGISTER_NEW_PATIENT'
        | 'PATIENTS_RECENT_PATIENTS'
        | 'PATIENTS_POSSIBLE_DUPLICATES'
    }
  | {
      readonly status: 'SCREENING_SESSIONS'
      readonly commandId:
        'HOME_TODAYS_SESSION' | 'SCREENING_TODAYS_SESSION' | 'SCREENING_NEW_SCREENING'
    }
  | {
      readonly status: 'ADMINISTRATION'
      readonly commandId: 'ADMINISTRATION_LOCATIONS'
    }
  | {
      readonly status: 'MANAGE_ENCOUNTERS'
      readonly commandId: 'SCREENING_MANAGE_ENCOUNTERS'
    }
  | {
      readonly status: 'REFERRALS'
      readonly commandId: 'HOME_OPEN_REFERRALS' | 'REFERRALS_REFERRAL_WORKLIST'
    }
  | {
      readonly status: 'PLANNED_MODULE'
      readonly commandId: ApplicationCommandId
      readonly heading: string
      readonly statement: string
      readonly plannedOwner: string
    }

export type WorkspaceNavigationGuard = (commandId: ApplicationCommandId) => boolean
export type PatientWorkspaceNavigationGuard = WorkspaceNavigationGuard

export interface ApplicationShellContext {
  readonly applicationName: string
  readonly applicationVersion: string
  readonly deploymentName: string
  readonly timeZone: string
}

export interface ApplicationShellUser {
  readonly username: string
  readonly displayName: string
  readonly role: LocalUserRole
}

export interface ApplicationShellState {
  readonly activeMenu: PrimaryApplicationMenu
  readonly commandPanelMenu: PrimaryApplicationMenu | null
  readonly selectedCommandId: ApplicationCommandId
  readonly route: ApplicationWorkspaceRoute
}

export interface ApplicationShellController {
  getSnapshot(): ApplicationShellState
  toggleMenu(menu: PrimaryApplicationMenu): void
  openMenu(menu: PrimaryApplicationMenu): void
  closeCommandPanel(): void
  selectCommand(commandId: ApplicationCommandId): void
  subscribe(listener: (state: ApplicationShellState) => void): () => void
  dispose(): void
}
