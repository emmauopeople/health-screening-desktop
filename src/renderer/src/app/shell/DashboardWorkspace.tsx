import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { HealthScreeningApi, PublicPatientSummary } from '@shared/ipc'

import { dashboardSummaryCards, getVisibleDashboardQuickActions } from './dashboard-workspace-model'
import type {
  ApplicationCommandId,
  ApplicationShellContext,
  ApplicationShellUser
} from './application-shell-types'

interface DashboardWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly context: ApplicationShellContext
  readonly user: ApplicationShellUser
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onQuickAction(commandId: ApplicationCommandId): void
  onStartScreening(patient: PublicPatientSummary): void
  onViewPatient(patient: PublicPatientSummary): void
}

export function DashboardWorkspace({
  api,
  context,
  user,
  headingId,
  headingRef,
  onQuickAction,
  onStartScreening,
  onViewPatient
}: DashboardWorkspaceProps): React.JSX.Element {
  const quickActions = getVisibleDashboardQuickActions(user.role)
  const [completedEncounters, setCompletedEncounters] = useState<number | null>(null)
  const [draftEncounters, setDraftEncounters] = useState<number | null>(null)
  const [openReferrals, setOpenReferrals] = useState<number | null>(null)
  const [patients, setPatients] = useState<readonly PublicPatientSummary[]>([])
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const loadCounts = useCallback(async (): Promise<void> => {
    const [completedResult, amendedResult, draftResult, referralResult] = await Promise.all([
      api.screeningEncounters.management.search({
        query: '',
        status: 'AMENDED',
        page: 1,
        pageSize: 25
      }),
      api.screeningEncounters.management.search({
        query: '',
        status: 'COMPLETED',
        page: 1,
        pageSize: 25
      }),
      api.screeningEncounters.management.search({
        query: '',
        status: 'DRAFT',
        page: 1,
        pageSize: 25
      }),
      api.referrals.search({
        query: '',
        statuses: ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM'],
        urgency: null,
        dueFrom: null,
        dueTo: null,
        page: 1,
        pageSize: 25
      })
    ])
    setCompletedEncounters(
      completedResult.ok &&
        completedResult.data.status === 'LOADED' &&
        amendedResult.ok &&
        amendedResult.data.status === 'LOADED'
        ? completedResult.data.total + amendedResult.data.total
        : null
    )
    setDraftEncounters(
      draftResult.ok && draftResult.data.status === 'LOADED' ? draftResult.data.total : null
    )
    setOpenReferrals(
      referralResult.ok && referralResult.data.status === 'LOADED'
        ? referralResult.data.total
        : null
    )
  }, [api])

  const loadPatients = useCallback(
    async (searchQuery: string, requestedPage: number): Promise<void> => {
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      const result = await api.patient.search({
        query: searchQuery,
        page: requestedPage,
        pageSize: 25
      })
      if (requestIdRef.current !== requestId) return
      if (result.ok) {
        setPatients(result.data.items)
        setPage(result.data.page)
        setTotal(result.data.total)
        setMessage(null)
      } else {
        setPatients([])
        setPage(1)
        setTotal(0)
        setMessage('Patient search could not be completed. Try again.')
      }
      setLoading(false)
    },
    [api]
  )

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (active) await loadCounts()
    })
    return () => {
      active = false
    }
  }, [loadCounts])

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length > 0 && normalized.length < 3) return

    if (normalized.length === 0) {
      let active = true
      void Promise.resolve().then(() => {
        if (active) void loadPatients(normalized, 1)
      })
      return () => {
        active = false
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadPatients(normalized, 1)
    }, 250)
    return () => window.clearTimeout(timeoutId)
  }, [loadPatients, query])

  useEffect(
    () => () => {
      requestIdRef.current += 1
    },
    []
  )

  const searchPatients = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault()
      const normalized = query.trim()
      if (normalized.length > 0 && normalized.length < 3) return
      await loadPatients(normalized, 1)
    },
    [loadPatients, query]
  )

  const totalPages = Math.max(1, Math.ceil(total / 25))

  const summaryValues: Readonly<Record<(typeof dashboardSummaryCards)[number]['key'], string>> = {
    completedEncounters: completedEncounters === null ? '\u2014' : String(completedEncounters),
    draftEncounters: draftEncounters === null ? '\u2014' : String(draftEncounters),
    openReferrals: openReferrals === null ? '\u2014' : String(openReferrals),
    pendingSync: '\u2014',
    lastBackup: '\u2014'
  }

  return (
    <div className="dashboard-workspace">
      <header className="application-workspace-heading">
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Welcome, {user.displayName}
        </h1>
        <p>{context.deploymentName}</p>
      </header>

      <section className="dashboard-summary" aria-labelledby="dashboard-summary-title">
        <h2 id="dashboard-summary-title" className="visually-hidden">
          Operational summary
        </h2>
        {dashboardSummaryCards.map((card) => (
          <article
            key={card.label}
            className="dashboard-summary-card"
            aria-label={`${card.label}: ${summaryValues[card.key]}. ${card.support}`}
            data-summary-accent={card.accent}
            title={card.support}
          >
            <div className="dashboard-summary-label">{card.label}</div>
            <div className="dashboard-summary-value">{summaryValues[card.key]}</div>
          </article>
        ))}
      </section>

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
            <h2 id="dashboard-worklist-title">Recent patients</h2>
          </div>
          <form
            className="dashboard-worklist-search-row"
            onSubmit={(event) => void searchPatients(event)}
          >
            <label className="visually-hidden" htmlFor="dashboard-patient-search">
              Patient search
            </label>
            <div className="dashboard-patient-search-group">
              <input
                id="dashboard-patient-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search by patient code, name, phone, village..."
              />
              <button type="submit" className="button button-primary" disabled={loading}>
                Search
              </button>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => onQuickAction('PATIENTS_REGISTER_NEW_PATIENT')}
            >
              Register patient
            </button>
          </form>
          {message === null ? null : (
            <p className="dashboard-data-note" role="alert">
              {message}
            </p>
          )}
          <div className="dashboard-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Patient code</th>
                  <th scope="col">Name</th>
                  <th scope="col">Age / sex</th>
                  <th scope="col">Current status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {patients.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {loading ? 'Loading patients...' : 'No patients to display.'}
                    </td>
                  </tr>
                ) : (
                  patients.map((patient) => (
                    <tr
                      key={patient.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open a new screening for ${patient.displayName}`}
                      onClick={() => onStartScreening(patient)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onStartScreening(patient)
                        }
                      }}
                    >
                      <td>{patient.patientCode}</td>
                      <td>{patient.displayName}</td>
                      <td>{formatPatientAgeSex(patient)}</td>
                      <td>{patient.status === 'ACTIVE' ? 'Active' : 'Inactive'}</td>
                      <td>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={(event) => {
                            event.stopPropagation()
                            onViewPatient(patient)
                          }}
                        >
                          View registry
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="screening-pagination" aria-label="Dashboard patient pagination">
            <span>
              {total === 0 ? 0 : (page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || page <= 1}
              onClick={() => void loadPatients(query.trim(), page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || page >= totalPages}
              onClick={() => void loadPatients(query.trim(), page + 1)}
            >
              Next
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function formatPatientAgeSex(patient: PublicPatientSummary): string {
  const age = patient.approximateAgeYears ?? ageFromDateOfBirth(patient.dateOfBirth)
  const sex =
    patient.sex === 'FEMALE'
      ? 'Female'
      : patient.sex === 'MALE'
        ? 'Male'
        : patient.sex === 'OTHER'
          ? 'Other'
          : 'Unknown'
  return `${age === null ? '\u2014' : age} / ${sex}`
}

function ageFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (dateOfBirth === null) return null
  const [year, month, day] = dateOfBirth.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return null
  const today = new Date()
  let age = today.getUTCFullYear() - year
  if (
    today.getUTCMonth() + 1 < month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
  )
    age -= 1
  return Math.max(0, age)
}
