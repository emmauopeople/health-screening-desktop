import type { RefObject } from 'react'
import { useState } from 'react'
import type {
  HealthScreeningApi,
  InstallationSettingsErrorCode,
  PatientErrorCode,
  PublicPatientDetail,
  ScreeningSessionErrorCode
} from '@shared/ipc'

import { InstallationLocationAdministrationWorkspace } from '../administration/InstallationLocationAdministrationWorkspace'
import { PatientRegistryWorkspace } from '../patients/PatientRegistryWorkspace'
import {
  ScreeningSessionWorkspace,
  type PatientScreeningTab
} from '../screening/ScreeningSessionWorkspace'
import { DashboardWorkspace } from './DashboardWorkspace'
import { PlannedModuleWorkspace } from './PlannedModuleWorkspace'
import type {
  ApplicationCommandId,
  ApplicationShellContext,
  ApplicationShellUser,
  ApplicationWorkspaceRoute,
  PatientWorkspaceNavigationGuard
} from './application-shell-types'

interface ApplicationWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly route: ApplicationWorkspaceRoute
  readonly workspaceRef: RefObject<HTMLElement | null>
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onSelectCommand(commandId: ApplicationCommandId): void
  onProtectedWorkspaceAuthenticationFailure(
    code: PatientErrorCode | ScreeningSessionErrorCode | InstallationSettingsErrorCode
  ): void
  registerNavigationGuard(guard: PatientWorkspaceNavigationGuard | null): void
}

const workspaceHeadingId = 'application-workspace-heading'

export function ApplicationWorkspace({
  api,
  context,
  user,
  route,
  workspaceRef,
  headingRef,
  onSelectCommand,
  onProtectedWorkspaceAuthenticationFailure,
  registerNavigationGuard
}: ApplicationWorkspaceProps): React.JSX.Element {
  const [selectedPatient, setSelectedPatient] = useState<PublicPatientDetail | null>(null)
  const [openScreeningPatientTabs, setOpenScreeningPatientTabs] = useState<
    readonly PatientScreeningTab[]
  >([])
  const [activeScreeningPatientId, setActiveScreeningPatientId] = useState<string | null>(null)

  return (
    <main
      ref={workspaceRef}
      className="application-workspace"
      aria-labelledby={workspaceHeadingId}
      data-shell-slot="workspace"
      data-shell-focus-zone="WORKSPACE"
    >
      {route.status === 'DASHBOARD' ? (
        <DashboardWorkspace
          context={context}
          user={user}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onQuickAction={onSelectCommand}
        />
      ) : route.status === 'PATIENTS' ? (
        <PatientRegistryWorkspace
          api={api}
          commandId={route.commandId}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          userRole={user.role}
          selectedPatient={selectedPatient}
          onSelectedPatientChange={setSelectedPatient}
          onPatientAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
          onSelectCommand={onSelectCommand}
          registerNavigationGuard={registerNavigationGuard}
        />
      ) : route.status === 'SCREENING_SESSIONS' ? (
        <ScreeningSessionWorkspace
          api={api}
          activePatientId={activeScreeningPatientId}
          commandId={route.commandId}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          openTabs={openScreeningPatientTabs}
          userRole={user.role}
          onActivePatientIdChange={setActiveScreeningPatientId}
          onOpenTabsChange={setOpenScreeningPatientTabs}
          onScreeningSessionAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
          onSelectCommand={onSelectCommand}
          registerNavigationGuard={registerNavigationGuard}
        />
      ) : route.status === 'ADMINISTRATION' ? (
        <InstallationLocationAdministrationWorkspace
          api={api}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          userRole={user.role}
          onAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
        />
      ) : (
        <PlannedModuleWorkspace
          route={route}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onBackToDashboard={() => onSelectCommand('HOME_DASHBOARD')}
        />
      )}
    </main>
  )
}
