import type { RefObject } from 'react'
import type { AuthenticationErrorCode, HealthScreeningApi, PublicPatientSummary } from '@shared/ipc'

import { DashboardWorkspace } from './DashboardWorkspace'
import { PlannedModuleWorkspace } from './PlannedModuleWorkspace'
import {
  PatientOverviewWorkspace,
  PatientRegistrationWorkspace,
  PatientSearchWorkspace
} from '../patients'
import type {
  ApplicationCommandId,
  ApplicationShellContext,
  ApplicationShellUser,
  ApplicationWorkspaceRoute
} from './application-shell-types'

interface ApplicationWorkspaceProps {
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly route: ApplicationWorkspaceRoute
  readonly api: HealthScreeningApi
  readonly patientSearchInitialQuery: string
  readonly patientSearchFocusSignal: number
  readonly activePatient: PublicPatientSummary | null
  readonly workspaceRef: RefObject<HTMLElement | null>
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onSelectCommand(commandId: ApplicationCommandId): void
  onPatientSearch(query: string): void
  onOpenPatient(patientId: string): void
  onBackToSearch(): void
  onCloseActivePatient(): void
  onAuthenticationFailure(code: AuthenticationErrorCode): void
}

const workspaceHeadingId = 'application-workspace-heading'

export function ApplicationWorkspace({
  context,
  user,
  route,
  api,
  patientSearchInitialQuery,
  patientSearchFocusSignal,
  activePatient,
  workspaceRef,
  headingRef,
  onSelectCommand,
  onPatientSearch,
  onOpenPatient,
  onBackToSearch,
  onCloseActivePatient,
  onAuthenticationFailure
}: ApplicationWorkspaceProps): React.JSX.Element {
  const effectiveRoute: ApplicationWorkspaceRoute =
    activePatient === null
      ? route
      : {
          status: 'PATIENT_OVERVIEW',
          commandId: route.commandId,
          patient: activePatient
        }

  return (
    <main
      ref={workspaceRef}
      className="application-workspace"
      aria-labelledby={workspaceHeadingId}
      data-shell-slot="workspace"
      data-shell-focus-zone="WORKSPACE"
    >
      {effectiveRoute.status === 'DASHBOARD' ? (
        <DashboardWorkspace
          context={context}
          user={user}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onQuickAction={onSelectCommand}
          onPatientSearch={onPatientSearch}
        />
      ) : null}
      {effectiveRoute.status === 'PATIENT_SEARCH' ? (
        <PatientSearchWorkspace
          key={`patient-search-${patientSearchFocusSignal}`}
          api={api}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          initialQuery={patientSearchInitialQuery}
          focusSignal={patientSearchFocusSignal}
          onOpenPatient={onOpenPatient}
          onRegisterPatient={() => onSelectCommand('PATIENTS_REGISTER_NEW_PATIENT')}
          onAuthenticationFailure={onAuthenticationFailure}
        />
      ) : null}
      {effectiveRoute.status === 'PATIENT_REGISTRATION' ? (
        <PatientRegistrationWorkspace
          api={api}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onOpenPatient={onOpenPatient}
          onCancel={() => onSelectCommand('PATIENTS_PATIENT_SEARCH')}
          onAuthenticationFailure={onAuthenticationFailure}
        />
      ) : null}
      {effectiveRoute.status === 'PATIENT_OVERVIEW' ? (
        <PatientOverviewWorkspace
          patient={effectiveRoute.patient}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onBackToSearch={onBackToSearch}
          onCloseTab={onCloseActivePatient}
        />
      ) : null}
      {effectiveRoute.status === 'PLANNED_MODULE' ? (
        <PlannedModuleWorkspace
          route={effectiveRoute}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onBackToDashboard={() => onSelectCommand('HOME_DASHBOARD')}
        />
      ) : null}
    </main>
  )
}
