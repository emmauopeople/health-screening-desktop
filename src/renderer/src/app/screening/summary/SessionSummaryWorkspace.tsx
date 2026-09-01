import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  PublicScreeningSessionSummary,
  ScreeningSessionErrorCode
} from '@shared/ipc'

interface SessionSummaryWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly timeZone: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: ScreeningSessionErrorCode): void
}

type SummaryState =
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly summary: PublicScreeningSessionSummary }
  | { readonly status: 'ERROR'; readonly message: string }

const protectedFailureCodes = new Set<ScreeningSessionErrorCode>([
  'IPC_FORBIDDEN',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export function SessionSummaryWorkspace({
  api,
  timeZone,
  headingId,
  headingRef,
  onAuthenticationFailure
}: SessionSummaryWorkspaceProps): React.JSX.Element {
  const requestRef = useRef(0)
  const [state, setState] = useState<SummaryState>({ status: 'LOADING' })

  const loadSummary = useCallback(async (): Promise<void> => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setState({ status: 'LOADING' })

    try {
      const currentResult = await api.screeningSessions.ensureCurrent()
      if (requestRef.current !== requestId) return

      if (!currentResult.ok) {
        if (protectedFailureCodes.has(currentResult.error.code)) {
          onAuthenticationFailure(currentResult.error.code)
          return
        }
        setState({ status: 'ERROR', message: 'Session summary could not be loaded.' })
        return
      }

      if (currentResult.data.status !== 'RESOLVED' && currentResult.data.status !== 'CREATED') {
        setState({ status: 'ERROR', message: 'No current screening session is available.' })
        return
      }

      const summaryResult = await api.screeningSessions.getSummary({
        sessionId: currentResult.data.session.id
      })
      if (requestRef.current !== requestId) return

      if (!summaryResult.ok) {
        if (protectedFailureCodes.has(summaryResult.error.code)) {
          onAuthenticationFailure(summaryResult.error.code)
          return
        }
        setState({ status: 'ERROR', message: 'Session summary could not be loaded.' })
        return
      }

      if (summaryResult.data.status === 'NOT_FOUND') {
        setState({ status: 'ERROR', message: 'No current screening session is available.' })
        return
      }

      setState({ status: 'READY', summary: summaryResult.data.summary })
    } catch {
      if (requestRef.current === requestId) {
        setState({ status: 'ERROR', message: 'Session summary could not be loaded.' })
      }
    }
  }, [api, onAuthenticationFailure])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => {
      if (active) void loadSummary()
    })
    return () => {
      active = false
      requestRef.current += 1
    }
  }, [loadSummary])

  return (
    <section className="session-summary-workspace" aria-labelledby={headingId}>
      <header className="session-summary-heading">
        <div>
          <p className="application-workspace-kicker">Current screening session</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Session Summary
          </h1>
        </div>
        <div className="session-summary-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadSummary()}
            disabled={state.status === 'LOADING'}
          >
            Refresh
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => window.print()}
            disabled={state.status !== 'READY'}
          >
            Print summary
          </button>
        </div>
      </header>

      {state.status === 'LOADING' ? (
        <div className="session-summary-state" role="status">
          Loading session summary…
        </div>
      ) : state.status === 'ERROR' ? (
        <div className="session-summary-state session-summary-state-error" role="alert">
          <strong>{state.message}</strong>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadSummary()}
          >
            Try again
          </button>
        </div>
      ) : (
        <SessionSummaryContent summary={state.summary} timeZone={timeZone} />
      )}
    </section>
  )
}

function SessionSummaryContent({
  summary,
  timeZone
}: {
  readonly summary: PublicScreeningSessionSummary
  readonly timeZone: string
}): React.JSX.Element {
  return (
    <div className="session-summary-print-area">
      <div className="session-summary-metadata">
        <SummaryMetadata label="Location" value={summary.location.name} />
        <SummaryMetadata label="Session date" value={formatSessionDate(summary.sessionDate)} />
        <SummaryMetadata label="Status" value={summary.status === 'OPEN' ? 'Open' : 'Closed'} />
        <SummaryMetadata
          label="Opened"
          value={`${formatTimestamp(summary.openedAt, timeZone)} by ${summary.openedBy.displayName}`}
        />
        <SummaryMetadata
          label="Closed"
          value={
            summary.closedAt === null
              ? '—'
              : `${formatTimestamp(summary.closedAt, timeZone)} by ${summary.closedBy?.displayName ?? 'Unknown'}`
          }
        />
      </div>

      <SummarySection heading="Encounters">
        <SummaryMetric label="Total encounters" value={summary.operational.totalEncounters} />
        <SummaryMetric
          label="Completed"
          value={summary.operational.finalizedEncounters}
          tone="success"
        />
        <SummaryMetric
          label="Active drafts"
          value={summary.operational.activeDrafts}
          tone="warning"
        />
        <SummaryMetric label="Empty drafts" value={summary.operational.emptyDrafts} />
        <SummaryMetric label="Voided" value={summary.operational.voidedEncounters} />
      </SummarySection>

      <SummarySection heading="Recommendations">
        <SummaryMetric label="Routine" value={summary.recommendations.routine} tone="success" />
        <SummaryMetric
          label="Standard referral"
          value={summary.recommendations.standardReferral}
          tone="referral"
        />
        <SummaryMetric
          label="Urgent referral"
          value={summary.recommendations.urgentReferral}
          tone="urgent"
        />
      </SummarySection>

      <SummarySection heading="Referrals">
        <SummaryMetric label="Open referrals" value={summary.referrals.open} tone="referral" />
        <SummaryMetric label="Closed referrals" value={summary.referrals.closed} tone="success" />
      </SummarySection>
    </div>
  )
}

function SummaryMetadata({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function SummarySection({
  heading,
  children
}: {
  readonly heading: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      className="session-summary-section"
      aria-labelledby={`session-summary-${heading.toLowerCase()}`}
    >
      <h2 id={`session-summary-${heading.toLowerCase()}`}>{heading}</h2>
      <div className="session-summary-metrics">{children}</div>
    </section>
  )
}

function SummaryMetric({
  label,
  value,
  tone = 'neutral'
}: {
  readonly label: string
  readonly value: number
  readonly tone?: 'neutral' | 'success' | 'warning' | 'referral' | 'urgent'
}): React.JSX.Element {
  return (
    <div className={`session-summary-metric session-summary-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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
