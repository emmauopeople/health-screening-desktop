/// <reference types="vite/client" />
import type { PublicScreeningSessionSummary } from '@shared/ipc'
import chsLogo from '../../../../../assests/images/small-logo.png'

export interface SessionReportDocumentProps {
  readonly summary: PublicScreeningSessionSummary
  readonly timeZone: string
  readonly reportedBy: string
  readonly generatedAt: string
}

export function SessionReportDocument({
  summary,
  timeZone,
  reportedBy,
  generatedAt
}: SessionReportDocumentProps): React.JSX.Element {
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${summary.sessionDate}T00:00:00Z`)
  )
  return (
    <article className="session-pdf-document" aria-label="Session report document">
      <header className="session-pdf-header">
        <div className="session-pdf-brand">
          <img className="session-pdf-logo" src={chsLogo} alt="CHS" />
          <strong>Community Health Screening</strong>
        </div>
        <p className="session-pdf-disclaimer">Screening guidance is not a diagnosis.</p>
        <h1>Screening session report</h1>
        <p className="session-pdf-location">{summary.location.name}</p>
        <p>Session date: {date}</p>
      </header>
      <dl className="session-pdf-metadata">
        <div>
          <dt>Status</dt>
          <dd>{summary.status === 'OPEN' ? 'Open' : 'Closed'}</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{timeZone}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>
            {timestamp(summary.openedAt, timeZone)} by {summary.openedBy.displayName}
          </dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>
            {summary.closedAt === null
              ? 'Not closed'
              : `${timestamp(summary.closedAt, timeZone)} by ${summary.closedBy?.displayName ?? 'Unknown'}`}
          </dd>
        </div>
        <div>
          <dt>Generated</dt>
          <dd>{timestamp(generatedAt, timeZone)}</dd>
        </div>
        <div>
          <dt>Reported by</dt>
          <dd>{reportedBy}</dd>
        </div>
      </dl>
      <MetricTable
        title="Encounters"
        rows={[
          ['Total encounters', summary.operational.totalEncounters],
          ['Completed', summary.operational.finalizedEncounters],
          ['Active drafts', summary.operational.activeDrafts],
          ['Empty drafts', summary.operational.emptyDrafts],
          ['Voided encounters', summary.operational.voidedEncounters]
        ]}
      />
      <MetricTable
        title="Recommendations"
        rows={[
          ['Routine', summary.recommendations.routine],
          ['Standard referral', summary.recommendations.standardReferral],
          ['Urgent referral', summary.recommendations.urgentReferral]
        ]}
      />
      <MetricTable
        title="Referrals"
        rows={[
          ['Open', summary.referrals.open],
          ['Closed', summary.referrals.closed]
        ]}
      />
      <p className="session-pdf-note">
        This report summarizes the selected session from local records at the time of preview. An
        open session may change as screening continues. Draft and voided encounter counts are shown
        separately from completed screenings.
      </p>
      <footer className="session-pdf-footer">
        <span>Session {date}</span>
        <span className="session-pdf-page-hint">
          Page numbers appear in the PDF and printed report
        </span>
        <span>Reported by: {reportedBy}</span>
      </footer>
    </article>
  )
}

function MetricTable({
  title,
  rows
}: {
  readonly title: string
  readonly rows: readonly (readonly [string, number])[]
}): React.JSX.Element {
  return (
    <table className="session-pdf-table" aria-label={title}>
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th scope="col">Count</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, count]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function timestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(value))
}
