import { useState, type RefObject } from 'react'

import { dashboardSummaryCards, getVisibleDashboardQuickActions } from './dashboard-workspace-model'
import type {
  ApplicationCommandId,
  ApplicationShellContext,
  ApplicationShellUser
} from './application-shell-types'

interface DashboardWorkspaceProps {
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onQuickAction(commandId: ApplicationCommandId): void
  onPatientSearch(query: string): void
}

export function DashboardWorkspace({
  context,
  user,
  headingId,
  headingRef,
  onQuickAction,
  onPatientSearch
}: DashboardWorkspaceProps): React.JSX.Element {
  const [patientSearch, setPatientSearch] = useState('')
  const quickActions = getVisibleDashboardQuickActions(user.role)
  const summaryNoteId = 'dashboard-summary-note'
  const worklistGuidanceId = 'dashboard-worklist-guidance'

  return (
    <>
      <header className="application-workspace-heading">
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Welcome, {user.displayName}
        </h1>
        <p>
          {context.deploymentName}
          {' \u2022 '}
          No screening session open
        </p>
      </header>

      <section
        className="dashboard-summary"
        aria-labelledby="dashboard-summary-title"
        aria-describedby={summaryNoteId}
      >
        <h2 id="dashboard-summary-title" className="visually-hidden">
          Operational summary
        </h2>
        {dashboardSummaryCards.map((card) => (
          <article
            key={card.label}
            className="dashboard-summary-card"
            aria-label={`${card.label}: data unavailable. ${card.support}`}
            data-summary-accent={card.accent}
            title={card.support}
          >
            <div className="dashboard-summary-label">{card.label}</div>
            <div className="dashboard-summary-value">{card.value}</div>
          </article>
        ))}
      </section>
      <p id={summaryNoteId} className="dashboard-data-note">
        Dashboard counts are unavailable until their future local data sources are implemented.
      </p>

      <div className="dashboard-lower-grid">
        <section
          className="dashboard-quick-actions"
          aria-labelledby="dashboard-quick-actions-title"
        >
          <h2 id="dashboard-quick-actions-title">Quick actions</h2>
          <div className="dashboard-quick-action-list">
            {quickActions.map((action, index) => (
              <button
                key={action.commandId}
                className="dashboard-quick-action"
                type="button"
                onClick={() => onQuickAction(action.commandId)}
              >
                <span className="dashboard-quick-action-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>
                  <span className="dashboard-quick-action-title">{action.label}</span>
                  <span className="dashboard-quick-action-support">{action.support}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-worklist" aria-labelledby="dashboard-worklist-title">
          <div className="dashboard-worklist-title-row">
            <h2 id="dashboard-worklist-title">{"Today's Patient Worklist"}</h2>
          </div>
          <div className="dashboard-worklist-search-row" aria-describedby={worklistGuidanceId}>
            <label htmlFor="dashboard-patient-search">Patient search</label>
            <input
              id="dashboard-patient-search"
              type="search"
              value={patientSearch}
              placeholder="Search by patient code, name, phone, village..."
              aria-describedby={worklistGuidanceId}
              onChange={(event) => setPatientSearch(event.target.value)}
            />
            <button
              type="button"
              className="button button-primary"
              aria-describedby={worklistGuidanceId}
              onClick={() => onPatientSearch(patientSearch)}
            >
              Search
            </button>
            <button
              type="button"
              className="button button-secondary"
              aria-describedby={worklistGuidanceId}
              onClick={() => onQuickAction('PATIENTS_REGISTER_NEW_PATIENT')}
            >
              Register patient
            </button>
          </div>
          <p id={worklistGuidanceId} className="dashboard-data-note">
            Patient search and registration use the local offline registry.
          </p>
          <div className="dashboard-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Patient code</th>
                  <th scope="col">Name</th>
                  <th scope="col">Age / sex</th>
                  <th scope="col">Last screening</th>
                  <th scope="col">Current status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6}>Patient worklist data is not available in HSD-025.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  )
}
