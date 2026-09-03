import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  PublicScreeningSessionSummary,
  ScreeningSessionErrorCode,
  ScreeningSessionStatus
} from '@shared/ipc'

interface SessionReportsWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly timeZone: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: ScreeningSessionErrorCode): void
  onOpenReferrals(sessionId: string): void
}

interface ReportFilters {
  readonly status: ScreeningSessionStatus | null
  readonly dateFrom: string | null
  readonly dateTo: string | null
}

interface ReportPage {
  readonly items: readonly PublicScreeningSessionSummary[]
  readonly page: number
  readonly total: number
}

type ReportState =
  | { readonly status: 'LOADING'; readonly previous: ReportPage | null }
  | { readonly status: 'READY'; readonly page: ReportPage }
  | { readonly status: 'ERROR'; readonly message: string; readonly previous: ReportPage | null }

const pageSize = 25
const protectedFailureCodes = new Set<ScreeningSessionErrorCode>([
  'IPC_FORBIDDEN',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export function SessionReportsWorkspace({
  api,
  timeZone,
  headingId,
  headingRef,
  onAuthenticationFailure,
  onOpenReferrals
}: SessionReportsWorkspaceProps): React.JSX.Element {
  const requestRef = useRef(0)
  const [filters, setFilters] = useState<ReportFilters>({
    status: null,
    dateFrom: null,
    dateTo: null
  })
  const [state, setState] = useState<ReportState>({ status: 'LOADING', previous: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const loadReports = useCallback(
    async (page: number, nextFilters: ReportFilters): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setState((current) => ({
        status: 'LOADING',
        previous: current.status === 'READY' ? current.page : current.previous
      }))
      try {
        const result = await api.screeningSessions.listSummaries({
          locationId: null,
          status: nextFilters.status,
          dateFrom: nextFilters.dateFrom,
          dateTo: nextFilters.dateTo,
          page,
          pageSize
        })
        if (requestRef.current !== requestId) return
        if (!result.ok) {
          if (protectedFailureCodes.has(result.error.code)) {
            onAuthenticationFailure(result.error.code)
            return
          }
          setState((current) => ({
            status: 'ERROR',
            message: 'Session reports could not be loaded.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
          return
        }
        const reportPage: ReportPage = Object.freeze({
          items: Object.freeze(result.data.items),
          page: result.data.page,
          total: result.data.total
        })
        setState({ status: 'READY', page: reportPage })
        setSelectedId((current) =>
          reportPage.items.some((item) => item.id === current)
            ? current
            : (reportPage.items[0]?.id ?? null)
        )
      } catch {
        if (requestRef.current === requestId) {
          setState((current) => ({
            status: 'ERROR',
            message: 'Session reports could not be loaded.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
        }
      }
    },
    [api, onAuthenticationFailure]
  )

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) void loadReports(1, filters)
    })
    return () => {
      active = false
      requestRef.current += 1
    }
  }, [filters, loadReports])

  const page = state.status === 'READY' ? state.page : state.previous
  const selected = page?.items.find((item) => item.id === selectedId) ?? null
  const totalPages = page === null ? 1 : Math.max(1, Math.ceil(page.total / pageSize))

  return (
    <section className="session-reports-workspace" aria-labelledby={headingId}>
      <header className="session-reports-heading">
        <div>
          <p className="application-workspace-kicker">Local historical reporting</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Session Reports
          </h1>
        </div>
        <div className="session-reports-heading-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadReports(page?.page ?? 1, filters)}
            disabled={state.status === 'LOADING'}
          >
            Refresh
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() =>
              selected === null
                ? undefined
                : printReport(`CHS-session-report-${selected.sessionDate}`)
            }
            disabled={selected === null}
          >
            Create PDF report
          </button>
        </div>
      </header>

      <div className="session-reports-filters" aria-label="Session report filters">
        <label>
          <span>Status</span>
          <select
            value={filters.status ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status:
                  event.target.value === '' ? null : (event.target.value as ScreeningSessionStatus)
              }))
            }
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            max={filters.dateTo ?? undefined}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dateFrom: event.target.value || null }))
            }
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            value={filters.dateTo ?? ''}
            min={filters.dateFrom ?? undefined}
            onChange={(event) =>
              setFilters((current) => ({ ...current, dateTo: event.target.value || null }))
            }
          />
        </label>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => setFilters({ status: null, dateFrom: null, dateTo: null })}
          disabled={filters.status === null && filters.dateFrom === null && filters.dateTo === null}
        >
          Clear filters
        </button>
      </div>

      {state.status === 'ERROR' && page === null ? (
        <div className="session-reports-state session-reports-state-error" role="alert">
          <strong>{state.message}</strong>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadReports(1, filters)}
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="session-reports-layout" aria-busy={state.status === 'LOADING'}>
          <section className="session-reports-list-panel" aria-label="Session report results">
            <div className="session-reports-list-summary">
              <strong>{page === null ? 'Loading reports…' : `${page.total} sessions`}</strong>
              {state.status === 'ERROR' ? <span role="alert">Refresh failed.</span> : null}
            </div>
            <div className="session-reports-table-scroll">
              <table className="session-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                    <th scope="col">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.items.map((item) => (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? 'is-selected' : undefined}
                      tabIndex={0}
                      aria-selected={item.id === selectedId}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedId(item.id)
                        }
                      }}
                    >
                      <td>{formatSessionDate(item.sessionDate)}</td>
                      <td>{item.location.name}</td>
                      <td>{item.status === 'OPEN' ? 'Open' : 'Closed'}</td>
                      <td>{item.operational.finalizedEncounters}</td>
                    </tr>
                  ))}
                  {page !== null && page.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="session-reports-empty">
                        No sessions match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="session-reports-pagination">
              <span>
                Page {page?.page ?? 1} / {totalPages}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={state.status === 'LOADING' || (page?.page ?? 1) <= 1}
                onClick={() => void loadReports((page?.page ?? 1) - 1, filters)}
              >
                Previous
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={state.status === 'LOADING' || (page?.page ?? 1) >= totalPages}
                onClick={() => void loadReports((page?.page ?? 1) + 1, filters)}
              >
                Next
              </button>
            </div>
          </section>

          <section className="session-reports-detail-panel" aria-label="Selected session report">
            {selected === null ? (
              <div className="session-reports-empty-detail">
                Select a session to view its report.
              </div>
            ) : (
              <SessionReportDetail
                summary={selected}
                timeZone={timeZone}
                onOpenReferrals={() => onOpenReferrals(selected.id)}
              />
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function SessionReportDetail({
  summary,
  timeZone,
  onOpenReferrals
}: {
  readonly summary: PublicScreeningSessionSummary
  readonly timeZone: string
  onOpenReferrals(): void
}): React.JSX.Element {
  return (
    <article className="session-report-print-area">
      <header className="clinical-report-masthead">
        <span className="clinical-report-logo" aria-hidden="true" />
        <div>
          <strong>Community Health Screening</strong>
          <span>Historical screening session report</span>
        </div>
      </header>
      <header>
        <p className="application-workspace-kicker">Screening session report</p>
        <h2>{formatSessionDate(summary.sessionDate)}</h2>
        <p>{summary.location.name}</p>
      </header>
      <dl className="session-report-metadata">
        <div>
          <dt>Status</dt>
          <dd>{summary.status === 'OPEN' ? 'Open' : 'Closed'}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{`${formatTimestamp(summary.openedAt, timeZone)} by ${summary.openedBy.displayName}`}</dd>
        </div>
        <div>
          <dt>Closed</dt>
          <dd>
            {summary.closedAt === null
              ? '—'
              : `${formatTimestamp(summary.closedAt, timeZone)} by ${summary.closedBy?.displayName ?? 'Unknown'}`}
          </dd>
        </div>
      </dl>
      <ReportGroup
        heading="Encounters"
        metrics={[
          ['Total', summary.operational.totalEncounters],
          ['Completed', summary.operational.finalizedEncounters],
          ['Active drafts', summary.operational.activeDrafts],
          ['Empty drafts', summary.operational.emptyDrafts],
          ['Voided', summary.operational.voidedEncounters]
        ]}
      />
      <ReportGroup
        heading="Recommendations"
        onOpenReferrals={onOpenReferrals}
        clickableLabels={['Routine', 'Standard referral', 'Urgent referral']}
        metrics={[
          ['Routine', summary.recommendations.routine],
          ['Standard referral', summary.recommendations.standardReferral],
          ['Urgent referral', summary.recommendations.urgentReferral]
        ]}
      />
      <ReportGroup
        heading="Referrals"
        onOpenReferrals={onOpenReferrals}
        clickableLabels={['Open']}
        metrics={[
          ['Open', summary.referrals.open],
          ['Closed', summary.referrals.closed]
        ]}
      />
      <p className="clinical-report-footer">
        Community Health Screening • Generated from verified local data
      </p>
    </article>
  )
}

function ReportGroup({
  heading,
  metrics,
  onOpenReferrals,
  clickableLabels = []
}: {
  readonly heading: string
  readonly metrics: readonly (readonly [string, number])[]
  onOpenReferrals?(): void
  readonly clickableLabels?: readonly string[]
}): React.JSX.Element {
  return (
    <section className="session-report-group">
      <h3>{heading}</h3>
      <div className="session-report-metrics">
        {metrics.map(([label, value]) => {
          const clickable = onOpenReferrals !== undefined && clickableLabels.includes(label)
          return (
            <button
              key={label}
              type="button"
              className="session-report-metric"
              onClick={clickable ? onOpenReferrals : undefined}
              disabled={!clickable}
            >
              <span>{label}</span>
              <strong>{value}</strong>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function formatSessionDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${month}/${day}/${year}`
}

function formatTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(value))
}

function printReport(fileName: string): void {
  const previousTitle = document.title
  document.title = fileName
  window.print()
  document.title = previousTitle
}
