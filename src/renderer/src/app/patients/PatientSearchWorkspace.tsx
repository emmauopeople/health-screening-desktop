import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthenticationErrorCode,
  HealthScreeningApi,
  PatientSearchSuccessData,
  PatientSex,
  PublicPatientSummary
} from '@shared/ipc'

import {
  formatPatientResidence,
  formatPatientSex,
  formatUnavailableClinicalValue
} from './patient-display'

interface PatientSearchWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>
  readonly initialQuery: string
  readonly focusSignal: number
  onOpenPatient(patientId: string): void
  onRegisterPatient(): void
  onAuthenticationFailure(code: AuthenticationErrorCode): void
}

type SearchState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING'; readonly showSkeleton: boolean }
  | { readonly status: 'RESULTS'; readonly data: PatientSearchSuccessData }
  | { readonly status: 'ERROR'; readonly message: string }

export function PatientSearchWorkspace({
  api,
  headingId,
  headingRef,
  initialQuery,
  focusSignal,
  onOpenPatient,
  onRegisterPatient,
  onAuthenticationFailure
}: PatientSearchWorkspaceProps): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [approximateAgeYears, setApproximateAgeYears] = useState('')
  const [sex, setSex] = useState<PatientSex | ''>('')
  const [village, setVillage] = useState('')
  const [quarter, setQuarter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [state, setState] = useState<SearchState>({ status: 'IDLE' })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const searchSequence = useRef(0)
  const hasRunInitialSearch = useRef(false)

  const runSearch = useCallback(
    async (nextPage = page) => {
      searchSequence.current += 1
      const sequence = searchSequence.current
      const skeletonTimer = setTimeout(() => {
        if (searchSequence.current === sequence) {
          setState({ status: 'LOADING', showSkeleton: true })
        }
      }, 250)
      setState({ status: 'LOADING', showSkeleton: false })

      const result = await api.patient.search({
        query,
        filters: {
          dateOfBirth: dateOfBirth.trim().length === 0 ? null : dateOfBirth,
          approximateAgeYears:
            approximateAgeYears.trim().length === 0 ? null : Number(approximateAgeYears),
          sex: sex === '' ? null : sex,
          village: village.trim().length === 0 ? null : village,
          quarter: quarter.trim().length === 0 ? null : quarter
        },
        page: nextPage,
        pageSize
      })

      clearTimeout(skeletonTimer)

      if (searchSequence.current !== sequence) {
        return
      }

      if (result.ok) {
        setPage(result.data.page)
        setState({ status: 'RESULTS', data: result.data })
        return
      }

      if (shouldFailClosed(result.error.code)) {
        onAuthenticationFailure(result.error.code)
        return
      }

      setState({ status: 'ERROR', message: result.error.message })
    },
    [
      api,
      approximateAgeYears,
      dateOfBirth,
      onAuthenticationFailure,
      page,
      pageSize,
      quarter,
      query,
      sex,
      village
    ]
  )

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [focusSignal])

  useEffect(() => {
    if (hasRunInitialSearch.current) {
      return
    }

    hasRunInitialSearch.current = true
    void runSearch(1)
  }, [runSearch])

  const results = state.status === 'RESULTS' ? state.data : null
  const firstShown =
    results === null || results.total === 0 ? 0 : (results.page - 1) * results.pageSize + 1
  const lastShown =
    results === null
      ? 0
      : Math.min(results.total, (results.page - 1) * results.pageSize + results.rows.length)
  const canGoPrevious = results !== null && results.page > 1
  const canGoNext = results !== null && lastShown < results.total

  return (
    <section className="patient-search-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading patient-workspace-heading">
        <p className="application-workspace-kicker">Patient registry</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Patient search
        </h1>
        <p>Search local registry records by code, name, phone, age, sex, village, or quarter.</p>
      </header>

      <form
        className="patient-search-form"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          void runSearch(1)
        }}
      >
        <div className="patient-search-primary">
          <label htmlFor="patient-search-query">Find patient</label>
          <input
            ref={inputRef}
            id="patient-search-query"
            type="search"
            value={query}
            placeholder="Patient code, name, phone, village, quarter"
            aria-describedby="patient-search-helper"
            onChange={(event) => setQuery(event.target.value)}
          />
          <p id="patient-search-helper">
            Results are local only and paginated. Clinical columns remain unavailable in HSD-025.
          </p>
        </div>
        <div className="patient-search-filters">
          <label>
            Sex
            <select value={sex} onChange={(event) => setSex(event.target.value as PatientSex | '')}>
              <option value="">Any</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label>
            DOB
            <input
              type="date"
              value={dateOfBirth}
              onChange={(event) => setDateOfBirth(event.target.value)}
            />
          </label>
          <label>
            Approx. age
            <input
              type="number"
              min={0}
              max={120}
              step={1}
              value={approximateAgeYears}
              onChange={(event) => setApproximateAgeYears(event.target.value)}
            />
          </label>
          <label>
            Village
            <input value={village} onChange={(event) => setVillage(event.target.value)} />
          </label>
          <label>
            Quarter
            <input value={quarter} onChange={(event) => setQuarter(event.target.value)} />
          </label>
          <label>
            Page size
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value) as 25 | 50 | 100)}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
        <div className="patient-search-actions">
          <button className="button button-primary" type="submit">
            Search
          </button>
          <button className="button button-secondary" type="button" onClick={onRegisterPatient}>
            Register patient
          </button>
        </div>
      </form>

      {state.status === 'LOADING' ? (
        <div className="patient-local-state" role="status">
          {state.showSkeleton ? 'Searching local registry...' : 'Loading'}
        </div>
      ) : null}
      {state.status === 'ERROR' ? (
        <div className="auth-alert patient-workspace-alert" role="alert">
          {state.message}
        </div>
      ) : null}
      {results !== null ? (
        <PatientSearchResults
          data={results}
          firstShown={firstShown}
          lastShown={lastShown}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          onPrevious={() => {
            const nextPage = Math.max(1, page - 1)
            setPage(nextPage)
            void runSearch(nextPage)
          }}
          onNext={() => {
            const nextPage = page + 1
            setPage(nextPage)
            void runSearch(nextPage)
          }}
          onOpenPatient={onOpenPatient}
        />
      ) : null}
    </section>
  )
}

function PatientSearchResults({
  data,
  firstShown,
  lastShown,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onOpenPatient
}: {
  readonly data: PatientSearchSuccessData
  readonly firstShown: number
  readonly lastShown: number
  readonly canGoPrevious: boolean
  readonly canGoNext: boolean
  onPrevious(): void
  onNext(): void
  onOpenPatient(patientId: string): void
}): React.JSX.Element {
  return (
    <section className="patient-results" aria-labelledby="patient-results-heading">
      <div className="patient-results-header">
        <h2 id="patient-results-heading">Search results</h2>
        <span aria-live="polite">
          Showing {firstShown}-{lastShown} of {data.total}
        </span>
      </div>
      <div className="patient-results-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Patient code</th>
              <th scope="col">Name</th>
              <th scope="col">Age/DOB</th>
              <th scope="col">Sex</th>
              <th scope="col">Village/quarter</th>
              <th scope="col">Last screening</th>
              <th scope="col">Referral/follow-up</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={8}>No local patient records match this search.</td>
              </tr>
            ) : (
              data.rows.map((patient) => (
                <PatientResultRow
                  key={patient.patientId}
                  patient={patient}
                  onOpenPatient={onOpenPatient}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="patient-pagination">
        <button
          className="button button-secondary"
          type="button"
          disabled={!canGoPrevious}
          onClick={onPrevious}
        >
          Previous
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={!canGoNext}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </section>
  )
}

function PatientResultRow({
  patient,
  onOpenPatient
}: {
  readonly patient: PublicPatientSummary
  onOpenPatient(patientId: string): void
}): React.JSX.Element {
  return (
    <tr>
      <td>{patient.patientCode}</td>
      <td>{patient.displayName}</td>
      <td>{patient.ageDobDisplay}</td>
      <td>{formatPatientSex(patient.sex)}</td>
      <td>{formatPatientResidence(patient)}</td>
      <td>{formatUnavailableClinicalValue()}</td>
      <td>{formatUnavailableClinicalValue()}</td>
      <td>
        <button
          className="button button-secondary patient-table-action"
          type="button"
          onClick={() => onOpenPatient(patient.patientId)}
        >
          Open tab
        </button>
      </td>
    </tr>
  )
}

function shouldFailClosed(code: AuthenticationErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED' ||
    code === 'AUTHENTICATION_UNAVAILABLE'
  )
}
