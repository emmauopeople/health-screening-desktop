/// <reference types="vite/client" />
import type {
  PublicAuditReportActor,
  PublicAuditReportDeployment,
  PublicAuditReportEvent
} from '@shared/ipc'
import logo from '../../../../../assests/images/small-logo.png'
import {
  auditFilterSummary,
  formatAuditCode,
  type AppliedAuditReportFilters
} from './audit-report-model'

export interface AuditReportDocumentProps {
  readonly page: {
    readonly items: readonly PublicAuditReportEvent[]
    readonly page: number
    readonly pageSize: 25 | 50 | 100
    readonly total: number
  }
  readonly context: {
    readonly deployment: PublicAuditReportDeployment
    readonly actors: readonly PublicAuditReportActor[]
  }
  readonly filters: AppliedAuditReportFilters
  readonly generatedAt: string
  readonly timeZone: string
  readonly reportedBy: string
}

export function AuditReportDocument({
  page,
  context,
  filters,
  generatedAt,
  timeZone,
  reportedBy
}: AuditReportDocumentProps): React.JSX.Element {
  const from = page.items.length === 0 ? 0 : (page.page - 1) * page.pageSize + 1
  const to = page.items.length === 0 ? 0 : from + page.items.length - 1
  return (
    <article className="audit-pdf-document">
      <header className="audit-pdf-header">
        <div className="audit-pdf-brand">
          <img className="audit-pdf-logo" src={logo} alt="CHS" />
          <strong>Community Health Screening</strong>
        </div>
        <p className="audit-pdf-disclaimer">Screening guidance is not a diagnosis</p>
        <h1>Audit report</h1>
        <p>
          <strong>{context.deployment.name}</strong>
        </p>
        <p>Read-only administrator report</p>
      </header>
      <dl className="audit-pdf-metadata">
        <div>
          <dt>Generated</dt>
          <dd>{formatTimestamp(generatedAt, timeZone)}</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{timeZone}</dd>
        </div>
        <div>
          <dt>Reported by</dt>
          <dd>{reportedBy}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>Current filtered results page only</dd>
        </div>
      </dl>
      <section className="audit-pdf-filters">
        <h2>Applied filters</h2>
        <p>{auditFilterSummary(filters, context.actors)}</p>
        <p>{`Showing ${from}-${to} of ${page.total} matching events; result page ${page.page} of ${Math.max(1, Math.ceil(page.total / page.pageSize))}.`}</p>
        <p>{`Rows per results page: ${page.pageSize}. Events are listed newest first.`}</p>
      </section>
      <table className="audit-pdf-table">
        <thead>
          <tr>
            <th scope="col">Date / time</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
          </tr>
        </thead>
        {page.items.map((event) => (
          <tbody
            key={event.id}
            className={
              JSON.stringify(event.metadata).length > 1500 ? 'audit-pdf-long-event' : undefined
            }
          >
            <tr className="audit-pdf-event">
              <td>{formatTimestamp(event.occurredAt, timeZone)}</td>
              <td>
                {event.actor === null
                  ? 'System'
                  : `${event.actor.displayName} (${event.actor.username})`}
              </td>
              <td>{formatAuditCode(event.action)}</td>
              <td>
                {formatAuditCode(event.entityType)}
                {event.entityId === null ? null : (
                  <>
                    <br />
                    {event.entityId}
                  </>
                )}
              </td>
            </tr>
            <tr className="audit-pdf-event-metadata">
              <td colSpan={4}>
                <strong>Metadata</strong>
                <pre>
                  {Object.keys(event.metadata).length === 0
                    ? 'No metadata recorded'
                    : JSON.stringify(event.metadata, null, 2)}
                </pre>
              </td>
            </tr>
          </tbody>
        ))}
        {page.items.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={4}>No audit events match these filters.</td>
            </tr>
          </tbody>
        ) : null}
      </table>
      <p className="audit-pdf-note">
        This report reflects local audit records loaded at preview time. Other results pages are not
        included.
      </p>
      <footer className="audit-pdf-footer">
        <span>{context.deployment.name}</span>
        <span>Page numbers appear in the PDF and printed report</span>
        <span>{`Reported by ${reportedBy}`}</span>
      </footer>
    </article>
  )
}

function formatTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(value))
}
