import type { RefObject } from 'react'
import { useState } from 'react'
import type {
  HealthScreeningApi,
  InstallationSettingsErrorCode,
  PatientErrorCode,
  PublicPatientDetail,
  PublicPatientSummary,
  ScreeningSessionErrorCode
} from '@shared/ipc'

import { InstallationLocationAdministrationWorkspace } from '../administration/InstallationLocationAdministrationWorkspace'
import { PatientRegistryWorkspace } from '../patients/PatientRegistryWorkspace'
import { ReferralWorklistWorkspace } from '../referrals/ReferralWorklistWorkspace'
import { ManageEncountersWorkspace } from '../screening/manage/ManageEncountersWorkspace'
import { SessionSummaryWorkspace } from '../screening/summary/SessionSummaryWorkspace'
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
  const [requestedScreeningPatient, setRequestedScreeningPatient] =
    useState<PublicPatientSummary | null>(null)
  const [requestedManagedEncounterId, setRequestedManagedEncounterId] = useState<string | null>(
    null
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
          api={api}
          context={context}
          user={user}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onQuickAction={onSelectCommand}
          onStartScreening={(patient) => {
            setRequestedScreeningPatient(patient)
            onSelectCommand('SCREENING_TODAYS_SESSION')
          }}
          onViewPatient={(patient) => {
            void api.patient.get({ patientId: patient.id }).then((result) => {
              if (!result.ok) {
                onProtectedWorkspaceAuthenticationFailure(result.error.code)
                return
              }
              setSelectedPatient(result.data)
              onSelectCommand('PATIENTS_PATIENT_SEARCH')
            })
          }}
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
          onOpenEncounter={(encounterId) => {
            setRequestedManagedEncounterId(encounterId)
            onSelectCommand('SCREENING_MANAGE_ENCOUNTERS')
          }}
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
          requestedPatient={requestedScreeningPatient}
          onActivePatientIdChange={setActiveScreeningPatientId}
          onOpenTabsChange={setOpenScreeningPatientTabs}
          onScreeningSessionAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
          onSelectCommand={onSelectCommand}
          onRequestedPatientConsumed={() => setRequestedScreeningPatient(null)}
          registerNavigationGuard={registerNavigationGuard}
        />
      ) : route.status === 'REFERRALS' ? (
        <ReferralWorklistWorkspace
          api={api}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
          onAuthenticationFailure={onProtectedWorkspaceAuthenticationFailure}
          onOpenPatient={(patientId) => {
            void api.patient.get({ patientId }).then((result) => {
              if (!result.ok) {
                onProtectedWorkspaceAuthenticationFailure(result.error.code)
                return
              }
              setSelectedPatient(result.data)
              onSelectCommand('PATIENTS_PATIENT_SEARCH')
            })
          }}
          onOpenEncounter={(encounterId) => {
            setRequestedManagedEncounterId(encounterId)
            onSelectCommand('SCREENING_MANAGE_ENCOUNTERS')
          }}
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
          requestedEncounterId={requestedManagedEncounterId}
          onRequestedEncounterConsumed={() => setRequestedManagedEncounterId(null)}
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
      ) : route.status === 'SESSION_SUMMARY' ? (
        <SessionSummaryWorkspace
          api={api}
          timeZone={context.timeZone}
          headingId={workspaceHeadingId}
          headingRef={headingRef}
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
