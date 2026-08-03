import type { RefObject } from 'react'
import { useCallback, useState } from 'react'
import type { HealthScreeningApi, PatientErrorCode, PublicPatientDetail } from '@shared/ipc'

import { PatientRegistryWorkspace } from '../patients/PatientRegistryWorkspace'
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
  readonly authGeneration: number
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly route: ApplicationWorkspaceRoute
  readonly workspaceRef: RefObject<HTMLElement | null>
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onSelectCommand(commandId: ApplicationCommandId): void
  onPatientAuthenticationFailure(code: PatientErrorCode): void
  registerNavigationGuard(guard: PatientWorkspaceNavigationGuard | null): void
}

const workspaceHeadingId = 'application-workspace-heading'

export function ApplicationWorkspace({
  api,
  authGeneration,
  context,
  user,
  route,
  workspaceRef,
  headingRef,
  onSelectCommand,
  onPatientAuthenticationFailure,
  registerNavigationGuard
}: ApplicationWorkspaceProps): React.JSX.Element {
  const [selectedPatientState, setSelectedPatientState] = useState<{
    readonly authGeneration: number
    readonly patient: PublicPatientDetail | null
  }>(() => ({ authGeneration, patient: null }))
  const selectedPatient =
    selectedPatientState.authGeneration === authGeneration && route.status === 'PATIENTS'
      ? selectedPatientState.patient
      : null
  const setSelectedPatient = useCallback(
    (patient: PublicPatientDetail | null): void => {
      setSelectedPatientState({ authGeneration, patient })
    },
    [authGeneration]
  )

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
          key={authGeneration}
          api={api}
          authGeneration={authGeneration}
          commandId={route.commandId}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          selectedPatient={selectedPatient}
          onSelectedPatientChange={setSelectedPatient}
          onPatientAuthenticationFailure={onPatientAuthenticationFailure}
          onSelectCommand={onSelectCommand}
          registerNavigationGuard={registerNavigationGuard}
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
