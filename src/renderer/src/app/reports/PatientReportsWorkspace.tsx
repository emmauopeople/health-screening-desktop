import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  PatientErrorCode,
  PublicPatientDetail,
  PublicPatientHistoryEncounter,
  PublicPatientScreeningHistory,
  PublicPatientSummary,
  ScreeningSessionErrorCode
} from '@shared/ipc'

interface PatientReportsWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly timeZone: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: PatientErrorCode | ScreeningSessionErrorCode): void
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}

interface PatientPage {
  readonly items: readonly PublicPatientSummary[]
  readonly page: number
  readonly total: number
}

type SearchState =
  | { readonly status: 'LOADING'; readonly previous: PatientPage | null }
  | { readonly status: 'READY'; readonly page: PatientPage }
  | { readonly status: 'ERROR'; readonly message: string; readonly previous: PatientPage | null }

type ReportState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING'; readonly patient: PublicPatientSummary }
  | {
      readonly status: 'READY'
      readonly patient: PublicPatientDetail
      readonly history: PublicPatientScreeningHistory
    }
  | { readonly status: 'ERROR'; readonly patient: PublicPatientSummary; readonly message: string }

const patientPageSize = 25
const reportHistoryPageSize = 100

export function PatientReportsWorkspace({
  api,
  timeZone,
  headingId,
  headingRef,
  onAuthenticationFailure,
  onOpenEncounter,
  onOpenReferral
}: PatientReportsWorkspaceProps): React.JSX.Element {
  const searchRequestRef = useRef(0)
  const reportRequestRef = useRef(0)
  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'LOADING',
    previous: null
  })
  const [reportState, setReportState] = useState<ReportState>({ status: 'IDLE' })

  const loadPatients = useCallback(
    async (page: number, searchQuery: string): Promise<void> => {
      const normalizedQuery = searchQuery.trim()
      if (normalizedQuery.length > 0 && normalizedQuery.length < 3) return
      const requestId = searchRequestRef.current + 1
      searchRequestRef.current = requestId
      setSearchState((current) => ({
        status: 'LOADING',
        previous: current.status === 'READY' ? current.page : current.previous
      }))
      try {
        const result = await api.patient.search({
          query: normalizedQuery,
          page,
          pageSize: patientPageSize
        })
        if (searchRequestRef.current !== requestId) return
        if (!result.ok) {
          if (isProtectedFailure(result.error.code)) {
            onAuthenticationFailure(result.error.code)
            return
          }
          setSearchState((current) => ({
            status: 'ERROR',
            message: 'Patient reports could not be searched.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
          return
        }
        setSearchState({
          status: 'READY',
          page: {
            items: result.data.items,
            page: result.data.page,
            total: result.data.total
          }
        })
      } catch {
        if (searchRequestRef.current === requestId) {
          setSearchState((current) => ({
            status: 'ERROR',
            message: 'Patient reports could not be searched.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
        }
      }
    },
    [api, onAuthenticationFailure]
  )

  const loadReport = useCallback(
    async (patient: PublicPatientSummary): Promise<void> => {
      const requestId = reportRequestRef.current + 1
      reportRequestRef.current = requestId
      setReportState({ status: 'LOADING', patient })
      try {
        const [patientResult, historyResult] = await Promise.all([
          api.patient.get({ patientId: patient.id }),
          api.screeningEncounters.management.getPatientHistory({
            patientId: patient.id,
            page: 1,
            pageSize: reportHistoryPageSize
          })
        ])
        if (reportRequestRef.current !== requestId) return
        if (!patientResult.ok) {
          if (isProtectedFailure(patientResult.error.code)) {
            onAuthenticationFailure(patientResult.error.code)
            return
          }
          setReportState({
            status: 'ERROR',
            patient,
            message: 'The patient report could not be loaded.'
          })
          return
        }
        if (!historyResult.ok) {
          if (isProtectedFailure(historyResult.error.code)) {
            onAuthenticationFailure(historyResult.error.code)
            return
          }
          setReportState({
            status: 'ERROR',
            patient,
            message: 'The patient screening history could not be loaded.'
          })
          return
        }
        if (historyResult.data.status !== 'LOADED') {
          if (isProtectedFailure(historyResult.data.status)) {
            onAuthenticationFailure(historyResult.data.status)
            return
          }
          setReportState({
            status: 'ERROR',
            patient,
            message:
              historyResult.data.status === 'PATIENT_NOT_FOUND'
                ? 'The patient report was not found.'
                : 'The patient screening history could not be loaded.'
          })
          return
        }
        setReportState({
          status: 'READY',
          patient: patientResult.data,
          history: historyResult.data.history
        })
      } catch {
        if (reportRequestRef.current === requestId) {
          setReportState({
            status: 'ERROR',
            patient,
            message: 'The patient report could not be loaded.'
          })
        }
      }
    },
    [api, onAuthenticationFailure]
  )

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length > 0 && normalizedQuery.length < 3) return
    const timeout = window.setTimeout(
      () => void loadPatients(1, normalizedQuery),
      normalizedQuery.length === 0 ? 0 : 250
    )
    return () => window.clearTimeout(timeout)
  }, [loadPatients, query])

  useEffect(
    () => () => {
      searchRequestRef.current += 1
      reportRequestRef.current += 1
    },
    []
  )

  const page = searchState.status === 'READY' ? searchState.page : searchState.previous
  const totalPages = Math.max(1, Math.ceil((page?.total ?? 0) / patientPageSize))
  const selectedPatientId =
    reportState.status === 'READY' ||
    reportState.status === 'LOADING' ||
    reportState.status === 'ERROR'
      ? reportState.patient.id
      : null
  const submitSearch = (event: FormEvent): void => {
    event.preventDefault()
    void loadPatients(1, query)
  }

  return (
    <section className="patient-reports-workspace" aria-labelledby={headingId}>
      <header className="patient-reports-heading">
        <div>
          <p className="application-workspace-kicker">Local patient reporting</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Patient Reports
          </h1>
        </div>
        <div className="patient-reports-heading-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={reportState.status !== 'READY'}
            onClick={() => {
              if (reportState.status === 'READY') void loadReport(reportState.patient)
            }}
          >
            Refresh report
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={reportState.status !== 'READY'}
            onClick={() => {
              if (reportState.status === 'READY') {
                printReport(`CHS-patient-report-${reportState.patient.patientCode}`)
              }
            }}
          >
            Create PDF report
          </button>
        </div>
      </header>

      <form className="patient-reports-search" onSubmit={submitSearch}>
        <label htmlFor="patient-report-search">Search patients</label>
        <div>
          <input
            id="patient-report-search"
            type="search"
            value={query}
            placeholder="Patient name, code, phone, DOB, village or quarter"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            className="button button-primary"
            type="submit"
            disabled={searchState.status === 'LOADING'}
          >
            Search
          </button>
        </div>
        {query.trim().length > 0 && query.trim().length < 3 ? (
          <span>Enter at least 3 characters.</span>
        ) : null}
      </form>

      <div className="patient-reports-layout">
        <section className="patient-reports-list-panel" aria-label="Patient report search results">
          <div className="patient-reports-list-summary">
            <strong>{page === null ? 'Loading patients…' : `${page.total} patients`}</strong>
            {searchState.status === 'ERROR' ? (
              <span role="alert">{searchState.message}</span>
            ) : null}
          </div>
          <div className="patient-reports-table-scroll">
            <table className="patient-reports-table">
              <thead>
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {page?.items.map((patient) => (
                  <tr
                    key={patient.id}
                    className={patient.id === selectedPatientId ? 'is-selected' : undefined}
                    tabIndex={0}
                    aria-selected={patient.id === selectedPatientId}
                    onClick={() => void loadReport(patient)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        void loadReport(patient)
                      }
                    }}
                  >
                    <td>
                      <strong>{patient.displayName}</strong>
                      <span>{patient.patientCode}</span>
                    </td>
                    <td>{formatPatientBirth(patient)}</td>
                    <td>{formatPatientLocation(patient)}</td>
                  </tr>
                ))}
                {page !== null && page.items.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="patient-reports-empty">
                      No patients match this search.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="patient-reports-pagination">
            <span>
              Page {page?.page ?? 1} / {totalPages}
            </span>
            <button
              className="button button-secondary"
              type="button"
              disabled={searchState.status === 'LOADING' || (page?.page ?? 1) <= 1}
              onClick={() => void loadPatients((page?.page ?? 1) - 1, query)}
            >
              Previous
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={searchState.status === 'LOADING' || (page?.page ?? 1) >= totalPages}
              onClick={() => void loadPatients((page?.page ?? 1) + 1, query)}
            >
              Next
            </button>
          </div>
        </section>

        <section className="patient-reports-detail-panel" aria-label="Selected patient report">
          {reportState.status === 'IDLE' ? (
            <div className="patient-reports-empty-detail">Select a patient to view the report.</div>
          ) : reportState.status === 'LOADING' ? (
            <div className="patient-reports-empty-detail" role="status">
              Loading {reportState.patient.displayName}…
            </div>
          ) : reportState.status === 'ERROR' ? (
            <div className="patient-reports-error" role="alert">
              <strong>{reportState.message}</strong>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void loadReport(reportState.patient)}
              >
                Try again
              </button>
            </div>
          ) : (
            <PatientReport
              patient={reportState.patient}
              history={reportState.history}
              timeZone={timeZone}
              onOpenEncounter={onOpenEncounter}
              onOpenReferral={onOpenReferral}
            />
          )}
        </section>
      </div>
    </section>
  )
}

function PatientReport({
  patient,
  history,
  timeZone,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly patient: PublicPatientDetail
  readonly history: PublicPatientScreeningHistory
  readonly timeZone: string
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  const latestEncounter = history.items[0] ?? null
  return (
    <article className="patient-report-print-area">
      <header className="clinical-report-masthead">
        <span className="clinical-report-logo" aria-hidden="true" />
        <div>
          <strong>Community Health Screening</strong>
          <span>Patient screening report</span>
        </div>
      </header>

      <header className="patient-report-title">
        <div>
          <p className="application-workspace-kicker">Patient report</p>
          <h2>{patient.displayName}</h2>
          <p>{patient.patientCode}</p>
        </div>
        <span className="status-pill">{formatLabel(patient.status)}</span>
      </header>

      <dl className="patient-report-demographics">
        <ReportMetadata label="Date of birth / age" value={formatPatientBirth(patient)} />
        <ReportMetadata label="Sex" value={formatSex(patient.sex)} />
        <ReportMetadata label="Village / quarter" value={formatPatientLocation(patient)} />
        <ReportMetadata label="Phone" value={patient.phone ?? 'Not recorded'} />
        <ReportMetadata label="Alternate contact" value={formatAlternateContact(patient)} />
        <ReportMetadata
          label="Report generated"
          value={formatTimestamp(new Date().toISOString(), timeZone)}
        />
      </dl>

      <section className="patient-report-summary" aria-label="Patient report summary">
        <ReportMetric label="Completed screenings" value={String(history.total)} />
        <ReportMetric
          label="30-day average BP"
          value={
            history.thirtyDayAverage === null
              ? '—'
              : `${history.thirtyDayAverage.systolic} / ${history.thirtyDayAverage.diastolic}`
          }
          support={
            history.thirtyDayAverage === null
              ? 'No recent readings'
              : `${history.thirtyDayAverage.encounterCount} screenings • mmHg`
          }
        />
        <ReportMetric
          label="Latest BP"
          value={
            latestEncounter === null
              ? '—'
              : `${latestEncounter.systolic} / ${latestEncounter.diastolic}`
          }
          support={latestEncounter === null ? 'No completed screenings' : 'mmHg'}
        />
        <ReportMetric
          label="Latest recommendation"
          value={latestEncounter === null ? '—' : formatAction(latestEncounter.nextAction)}
        />
      </section>

      <section className="patient-report-section">
        <h3>Recent trend</h3>
        {history.trendEncounters.length === 0 ? (
          <p>No completed screening readings.</p>
        ) : (
          <div className="patient-report-table-wrap">
            <table className="patient-report-table patient-report-trend-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Blood pressure</th>
                  <th scope="col">Pulse</th>
                  <th scope="col">Weight</th>
                </tr>
              </thead>
              <tbody>
                {history.trendEncounters.map((encounter) => (
                  <tr key={encounter.id}>
                    <td>{formatTimestamp(encounter.completedAt, timeZone, false)}</td>
                    <td>{`${encounter.systolic} / ${encounter.diastolic} mmHg`}</td>
                    <td>{`${encounter.pulse} bpm`}</td>
                    <td>{encounter.weightKg === null ? '—' : `${encounter.weightKg} kg`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="patient-report-section">
        <div className="patient-report-section-heading">
          <h3>Screening history</h3>
          <span>
            {history.total > history.items.length
              ? `Most recent ${history.items.length} of ${history.total}`
              : `${history.total} completed`}
          </span>
        </div>
        {history.items.length === 0 ? (
          <p>No completed screenings.</p>
        ) : (
          <div className="patient-report-table-wrap">
            <table className="patient-report-table">
              <thead>
                <tr>
                  <th scope="col">Screening</th>
                  <th scope="col">Vitals</th>
                  <th scope="col">Recommendation</th>
                  <th scope="col">Referral and follow-up</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((encounter) => (
                  <PatientReportEncounterRow
                    key={encounter.id}
                    encounter={encounter}
                    timeZone={timeZone}
                    onOpenEncounter={onOpenEncounter}
                    onOpenReferral={onOpenReferral}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="clinical-report-footer">
        Community Health Screening • Generated from verified local data • Screening guidance is not
        a diagnosis
      </p>
    </article>
  )
}

function PatientReportEncounterRow({
  encounter,
  timeZone,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly encounter: PublicPatientHistoryEncounter
  readonly timeZone: string
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  const followup = encounter.referral?.latestFollowup ?? null
  const referral = encounter.referral
  return (
    <tr>
      <td>
        <strong>{formatTimestamp(encounter.completedAt, timeZone, false)}</strong>
        <button
          className="patient-report-record-link"
          type="button"
          onClick={() => onOpenEncounter(encounter.id)}
        >
          Open encounter
        </button>
      </td>
      <td>
        <strong>{`${encounter.systolic} / ${encounter.diastolic} mmHg`}</strong>
        <span>{`${encounter.pulse} bpm`}</span>
        <span>
          {encounter.weightKg === null ? 'Weight not recorded' : `${encounter.weightKg} kg`}
        </span>
      </td>
      <td>{formatAction(encounter.nextAction)}</td>
      <td>
        {referral === null ? (
          <span>None</span>
        ) : (
          <>
            <button
              className="patient-report-record-link"
              type="button"
              onClick={() => onOpenReferral(referral.id)}
            >
              {`${formatLabel(referral.status)} • ${formatLabel(referral.urgency)}`}
            </button>
            <span>
              {followup === null
                ? 'No follow-up recorded'
                : (followup.reportedOutcome ??
                  `Follow-up ${formatLocalDate(followup.contactDate)}`)}
            </span>
          </>
        )}
      </td>
    </tr>
  )
}

function ReportMetadata({
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

function ReportMetric({
  label,
  value,
  support
}: {
  readonly label: string
  readonly value: string
  readonly support?: string
}): React.JSX.Element {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {support === undefined ? null : <small>{support}</small>}
    </div>
  )
}

function isProtectedFailure(
  code: string
): code is
  | 'IPC_FORBIDDEN'
  | 'AUTH_UNAUTHENTICATED'
  | 'AUTH_LOCKED'
  | 'AUTH_PASSWORD_CHANGE_REQUIRED'
  | 'AUTHORIZATION_FAILED' {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}

function formatPatientBirth(patient: PublicPatientSummary): string {
  if (patient.dateOfBirth !== null) return formatLocalDate(patient.dateOfBirth)
  if (patient.approximateAgeYears === null) return 'Not recorded'
  return `Approximately ${patient.approximateAgeYears} years${
    patient.ageAsOfDate === null ? '' : ` as of ${formatLocalDate(patient.ageAsOfDate)}`
  }`
}

function formatPatientLocation(patient: PublicPatientSummary): string {
  return [patient.village, patient.quarter].filter((value) => value !== null).join(' / ') || '—'
}

function formatAlternateContact(patient: PublicPatientDetail): string {
  if (patient.alternateContactName === null && patient.alternateContactPhone === null) {
    return 'Not recorded'
  }
  return [patient.alternateContactName, patient.alternateContactPhone]
    .filter((value) => value !== null)
    .join(' • ')
}

function formatSex(value: PublicPatientSummary['sex']): string {
  return value === 'FEMALE' ? 'Female' : value === 'MALE' ? 'Male' : 'Unknown'
}

function formatAction(value: PublicPatientHistoryEncounter['nextAction']): string {
  return value === 'URGENT_REFERRAL'
    ? 'Urgent referral'
    : value === 'REFER'
      ? 'Standard referral'
      : 'Routine'
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, day!))
  )
}

function formatTimestamp(value: string, timeZone: string, includeTime = true): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
    timeZone
  }).format(new Date(value))
}

function printReport(fileName: string): void {
  const previousTitle = document.title
  document.title = fileName
  window.print()
  document.title = previousTitle
}
