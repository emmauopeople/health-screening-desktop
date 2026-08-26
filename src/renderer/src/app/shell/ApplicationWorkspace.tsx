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
import { ManageEncountersWorkspace } from '../screening/manage/ManageEncountersWorkspace'
import {
  createPatientScreeningTab,
  ScreeningSessionWorkspace,
  type PatientScreeningTab
} from '../screening/ScreeningSessionWorkspace'
import { screeningPatientTabLimit } from '../screening/screening-session-workspace-model'
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
          api={api}
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
      ) : route.status === 'MANAGE_ENCOUNTERS' ? (
        <ManageEncountersWorkspace
          api={api}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
          onResumeDraft={(patient, encounter) => {
            const existingTab = openScreeningPatientTabs.find(
              (tab) => tab.encounter.id === encounter.id
            )
            if (existingTab !== undefined) {
              setActiveScreeningPatientId(existingTab.patient.id)
              onSelectCommand('SCREENING_NEW_SCREENING')
              return true
            }
            const replacesCompletedPatient = openScreeningPatientTabs.some(
              (tab) => tab.patient.id === patient.id && tab.encounter.status !== 'DRAFT'
            )
            if (
              !replacesCompletedPatient &&
              openScreeningPatientTabs.length >= screeningPatientTabLimit
            )
              return false
            setOpenScreeningPatientTabs((currentTabs) => [
              ...currentTabs.filter(
                (tab) => tab.patient.id !== patient.id || tab.encounter.status === 'DRAFT'
              ),
              createPatientScreeningTab(patient, encounter)
            ])
            setActiveScreeningPatientId(patient.id)
            onSelectCommand('SCREENING_NEW_SCREENING')
            return true
          }}
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
