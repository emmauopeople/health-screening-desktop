import type { RefObject } from 'react'
import type { PublicPatientSummary } from '@shared/ipc'

import {
  formatPatientResidence,
  formatPatientSex,
  formatUnavailableClinicalValue
} from './patient-display'

interface PatientOverviewWorkspaceProps {
  readonly patient: PublicPatientSummary
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onBackToSearch(): void
  onCloseTab(): void
}

export function PatientOverviewWorkspace({
  patient,
  headingId,
  headingRef,
  onBackToSearch,
  onCloseTab
}: PatientOverviewWorkspaceProps): React.JSX.Element {
  const panelId = `patient-tabpanel-${patient.patientId}`

  return (
    <section
      id={panelId}
      className="patient-overview-workspace"
      role="tabpanel"
      aria-labelledby={`patient-tab-${patient.patientId}`}
    >
      <header className="application-workspace-heading patient-workspace-heading">
        <p className="application-workspace-kicker">Patient overview</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          {patient.patientCode} {patient.displayName}
        </h1>
        <p>Read-only registry summary. Screening and referral modules are not implemented.</p>
      </header>

      <div className="patient-overview-actions">
        <button className="button button-secondary" type="button" onClick={onBackToSearch}>
          Back to search
        </button>
        <button className="button button-secondary" type="button" onClick={onCloseTab}>
          Close tab
        </button>
      </div>

      <section className="patient-overview-grid" aria-label="Patient registry summary">
        <div>
          <dt>Patient code</dt>
          <dd>{patient.patientCode}</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{patient.displayName}</dd>
        </div>
        <div>
          <dt>Age / DOB</dt>
          <dd>{patient.ageDobDisplay}</dd>
        </div>
        <div>
          <dt>Sex</dt>
          <dd>{formatPatientSex(patient.sex)}</dd>
        </div>
        <div>
          <dt>Village / quarter</dt>
          <dd>{formatPatientResidence(patient)}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{patient.phoneAvailable ? 'Recorded' : 'Not available'}</dd>
        </div>
      </section>

      <div className="patient-future-grid">
        <section className="patient-future-panel" aria-labelledby="patient-history-heading">
          <h2 id="patient-history-heading">Screening history</h2>
          <p>{formatUnavailableClinicalValue()}</p>
        </section>
        <section className="patient-future-panel" aria-labelledby="patient-referral-heading">
          <h2 id="patient-referral-heading">Referral / follow-up</h2>
          <p>{formatUnavailableClinicalValue()}</p>
        </section>
      </div>
    </section>
  )
}
