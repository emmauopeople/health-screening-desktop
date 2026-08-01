import type { RefObject } from 'react'

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
}

export function DashboardWorkspace({
  context,
  user,
  headingId,
  headingRef,
  onQuickAction
}: DashboardWorkspaceProps): React.JSX.Element {
  const quickActions = getVisibleDashboardQuickActions(user.role)

  return (
    <>
      <div className="application-workspace-heading">
        <div>
          <p className="application-workspace-kicker">Dashboard</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Welcome, {user.displayName}
          </h1>
        </div>
        <dl className="dashboard-context-list" aria-label="Current deployment context">
          <div>
            <dt>Deployment</dt>
            <dd>{context.deploymentName}</dd>
          </div>
          <div>
            <dt>Time zone</dt>
            <dd>{context.timeZone}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>No active location selected</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>No screening session open</dd>
          </div>
        </dl>
      </div>

      <section className="dashboard-summary" aria-label="Operational summary">
        {dashboardSummaryCards.map((card) => (
          <article key={card.label} className="dashboard-summary-card" aria-label={card.label}>
            <div className="dashboard-summary-label">{card.label}</div>
            <div className="dashboard-summary-value">{card.value}</div>
            <p>{card.support}</p>
          </article>
        ))}
      </section>

      <section className="dashboard-quick-actions" aria-labelledby="dashboard-quick-actions-title">
        <h2 id="dashboard-quick-actions-title">Quick actions</h2>
        <div className="dashboard-quick-action-list">
          {quickActions.map((action) => (
            <button
              key={action.commandId}
              className="dashboard-quick-action"
              type="button"
              onClick={() => onQuickAction(action.commandId)}
            >
              <span>{action.label}</span>
              <span>Planned workspace</span>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-worklist" aria-labelledby="dashboard-worklist-title">
        <div className="dashboard-worklist-header">
          <div>
            <h2 id="dashboard-worklist-title">Today\u2019s patient worklist</h2>
            <p>Patient worklist data is not available in HSD-024.</p>
          </div>
          <label className="dashboard-disabled-search">
            <span>Patient search is available in HSD-025.</span>
            <input
              type="search"
              value=""
              disabled
              readOnly
              aria-label="Patient search is available in HSD-025."
            />
          </label>
        </div>
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
                <td colSpan={6}>Patient worklist data is not available in HSD-024.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
