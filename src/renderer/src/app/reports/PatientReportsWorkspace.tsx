import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject
} from 'react'
import type {
  HealthScreeningApi,
  PatientErrorCode,
  PublicPatientSummary,
  ScreeningSessionErrorCode
} from '@shared/ipc'
import { PatientReportDocument } from './PatientReportDocument'
import {
  createPresetDateRange,
  isValidDateRange,
  loadPatientReport,
  type PatientReportData,
  type PatientReportDateRange,
  type PatientReportKind,
  type PatientReportRangePreset
} from './patient-report-model'

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
  | { readonly status: 'READY'; readonly report: PatientReportData }
  | { readonly status: 'ERROR'; readonly patient: PublicPatientSummary; readonly message: string }

const patientPageSize = 25
const reportKinds: readonly { readonly value: PatientReportKind; readonly label: string }[] = [
  { value: 'GENERAL', label: 'General' },
  { value: 'VITALS', label: 'Vitals' },
  { value: 'LIFESTYLE', label: 'Lifestyle' },
  { value: 'REFERRALS', label: 'Referrals' }
]

export function PatientReportsWorkspace({
  api,
  timeZone,
  headingId,
  headingRef,
  onAuthenticationFailure,
  onOpenEncounter,
  onOpenReferral
}: PatientReportsWorkspaceProps): React.JSX.Element {
  const initialRange = useMemo(() => createPresetDateRange('LAST_30_DAYS', timeZone), [timeZone])
  const searchRequestRef = useRef(0)
  const reportRequestRef = useRef(0)
  const printButtonRef = useRef<HTMLButtonElement | null>(null)
  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'LOADING',
    previous: null
  })
  const [selectedPatient, setSelectedPatient] = useState<PublicPatientSummary | null>(null)
  const [reportState, setReportState] = useState<ReportState>({ status: 'IDLE' })
  const [reportKind, setReportKind] = useState<PatientReportKind>('GENERAL')
  const [rangePreset, setRangePreset] = useState<PatientReportRangePreset>('LAST_30_DAYS')
  const [range, setRange] = useState<PatientReportDateRange>(initialRange)
  const [customFrom, setCustomFrom] = useState(initialRange.from)
  const [customTo, setCustomTo] = useState(initialRange.to)
  const [rangeMessage, setRangeMessage] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

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
          if (result.error.code === 'IPC_FORBIDDEN') {
            onAuthenticationFailure('IPC_FORBIDDEN')
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

  const refreshReport = useCallback(
    async (
      patient: PublicPatientSummary,
      nextKind: PatientReportKind,
      nextRange: PatientReportDateRange
    ): Promise<void> => {
      const requestId = reportRequestRef.current + 1
      reportRequestRef.current = requestId
      setPreviewOpen(false)
      setReportState({ status: 'LOADING', patient })
      const result = await loadPatientReport(api, patient, nextKind, nextRange, timeZone)
      if (reportRequestRef.current !== requestId) return
      if (result.status === 'AUTHENTICATION_FAILED') {
        onAuthenticationFailure(result.code)
        return
      }
      if (result.status === 'FAILED') {
        setReportState({ status: 'ERROR', patient, message: result.message })
        return
      }
      setReportState({ status: 'READY', report: result.report })
    },
    [api, onAuthenticationFailure, timeZone]
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

  useEffect(() => {
    if (!previewOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    printButtonRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewOpen])

  useEffect(
    () => () => {
      searchRequestRef.current += 1
      reportRequestRef.current += 1
    },
    []
  )

  const page = searchState.status === 'READY' ? searchState.page : searchState.previous
  const totalPages = Math.max(1, Math.ceil((page?.total ?? 0) / patientPageSize))
  const submitSearch = (event: FormEvent): void => {
    event.preventDefault()
    void loadPatients(1, query)
  }
  const applyPreset = (preset: Exclude<PatientReportRangePreset, 'CUSTOM'>): void => {
    const nextRange = createPresetDateRange(preset, timeZone)
    setRangePreset(preset)
    setRange(nextRange)
    setCustomFrom(nextRange.from)
    setCustomTo(nextRange.to)
    setRangeMessage(null)
    if (selectedPatient !== null) void refreshReport(selectedPatient, reportKind, nextRange)
  }
  const applyCustomRange = (): void => {
    const nextRange = { from: customFrom, to: customTo }
    if (!isValidDateRange(nextRange)) {
      setRangeMessage('Enter a valid start and end date. The start must be before the end.')
      return
    }
    setRangePreset('CUSTOM')
    setRange(nextRange)
    setRangeMessage(null)
    if (selectedPatient !== null) void refreshReport(selectedPatient, reportKind, nextRange)
  }
  const selectPatient = (patient: PublicPatientSummary): void => {
    setSelectedPatient(patient)
    void refreshReport(patient, reportKind, range)
  }
  const selectReportKind = (nextKind: PatientReportKind): void => {
    setReportKind(nextKind)
    if (selectedPatient !== null) void refreshReport(selectedPatient, nextKind, range)
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
      </header>

      <div className="patient-reports-layout">
        <section className="patient-reports-list-panel" aria-label="Patient report search results">
          <form className="patient-reports-search" onSubmit={submitSearch}>
            <label htmlFor="patient-report-search">Search patients</label>
            <div>
              <input
                id="patient-report-search"
                type="search"
                value={query}
                placeholder="Name, patient ID, phone or location"
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
          <div className="patient-reports-list-summary">
            <strong>{page === null ? 'Loading patients...' : `${page.total} patients`}</strong>
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
                    className={patient.id === selectedPatient?.id ? 'is-selected' : undefined}
                    tabIndex={0}
                    aria-selected={patient.id === selectedPatient?.id}
                    onClick={() => selectPatient(patient)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectPatient(patient)
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
          {selectedPatient === null ? null : (
            <ReportControls
              kind={reportKind}
              preset={rangePreset}
              customFrom={customFrom}
              customTo={customTo}
              rangeMessage={rangeMessage}
              maximumDate={createPresetDateRange('LAST_7_DAYS', timeZone).to}
              loading={reportState.status === 'LOADING'}
              onKindChange={selectReportKind}
              onPresetChange={applyPreset}
              onCustomFromChange={setCustomFrom}
              onCustomToChange={setCustomTo}
              onApplyCustom={applyCustomRange}
              onRefresh={() => void refreshReport(selectedPatient, reportKind, range)}
            />
          )}

          {reportState.status === 'IDLE' ? (
            <div className="patient-reports-empty-detail">Select a patient to create a report.</div>
          ) : reportState.status === 'LOADING' ? (
            <div className="patient-reports-empty-detail" role="status">
              Creating {reportKind.toLowerCase()} report for {reportState.patient.displayName}...
            </div>
          ) : reportState.status === 'ERROR' ? (
            <div className="patient-reports-error" role="alert">
              <strong>{reportState.message}</strong>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void refreshReport(reportState.patient, reportKind, range)}
              >
                Try again
              </button>
            </div>
          ) : (
            <PatientReportDocument
              report={reportState.report}
              timeZone={timeZone}
              preview={false}
              onOpenEncounter={onOpenEncounter}
              onOpenReferral={onOpenReferral}
              onOpenPrintPreview={() => setPreviewOpen(true)}
            />
          )}
        </section>
      </div>

      {previewOpen && reportState.status === 'READY' ? (
        <PrintPreview
          report={reportState.report}
          timeZone={timeZone}
          printButtonRef={printButtonRef}
          onClose={() => setPreviewOpen(false)}
          onOpenEncounter={onOpenEncounter}
          onOpenReferral={onOpenReferral}
        />
      ) : null}
    </section>
  )
}

function ReportControls({
  kind,
  preset,
  customFrom,
  customTo,
  rangeMessage,
  maximumDate,
  loading,
  onKindChange,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
  onRefresh
}: {
  readonly kind: PatientReportKind
  readonly preset: PatientReportRangePreset
  readonly customFrom: string
  readonly customTo: string
  readonly rangeMessage: string | null
  readonly maximumDate: string
  readonly loading: boolean
  onKindChange(kind: PatientReportKind): void
  onPresetChange(preset: Exclude<PatientReportRangePreset, 'CUSTOM'>): void
  onCustomFromChange(value: string): void
  onCustomToChange(value: string): void
  onApplyCustom(): void
  onRefresh(): void
}): React.JSX.Element {
  return (
    <section className="patient-report-controls" aria-label="Patient report options">
      <div className="patient-report-control-row">
        <span>Report</span>
        <div className="patient-report-segmented-control">
          {reportKinds.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => onKindChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="button button-secondary patient-report-refresh"
          type="button"
          disabled={loading}
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>
      <div className="patient-report-control-row">
        <span>Date range</span>
        <div className="patient-report-segmented-control">
          <button
            type="button"
            aria-pressed={preset === 'LAST_7_DAYS'}
            onClick={() => onPresetChange('LAST_7_DAYS')}
          >
            Last 7 days
          </button>
          <button
            type="button"
            aria-pressed={preset === 'LAST_30_DAYS'}
            onClick={() => onPresetChange('LAST_30_DAYS')}
          >
            Last 30 days
          </button>
        </div>
        <label>
          From
          <input
            type="date"
            value={customFrom}
            max={maximumDate}
            onChange={(event) => onCustomFromChange(event.currentTarget.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={customTo}
            max={maximumDate}
            onChange={(event) => onCustomToChange(event.currentTarget.value)}
          />
        </label>
        <button className="button button-secondary" type="button" onClick={onApplyCustom}>
          Apply dates
        </button>
      </div>
      {rangeMessage === null ? null : <p role="alert">{rangeMessage}</p>}
    </section>
  )
}

function PrintPreview({
  report,
  timeZone,
  printButtonRef,
  onClose,
  onOpenEncounter,
  onOpenReferral
}: {
  readonly report: PatientReportData
  readonly timeZone: string
  readonly printButtonRef: RefObject<HTMLButtonElement | null>
  onClose(): void
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}): React.JSX.Element {
  return (
    <div className="patient-report-preview-backdrop">
      <section
        className="patient-report-preview-window"
        role="dialog"
        aria-modal="true"
        aria-label="Patient report print preview"
      >
        <header className="patient-report-preview-toolbar">
          <div>
            <strong>Print preview</strong>
            <span>Review the complete report before printing or saving as PDF.</span>
          </div>
          <div>
            <button
              ref={printButtonRef}
              className="button button-primary"
              type="button"
              onClick={() =>
                printReport(`CHS-${report.kind.toLowerCase()}-${report.patient.patientCode}`)
              }
            >
              <PrintIcon />
              Print
            </button>
            <button className="button button-secondary" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="patient-report-preview-scroll">
          <div className="patient-report-preview-page">
            <PatientReportDocument
              report={report}
              timeZone={timeZone}
              preview
              onOpenEncounter={onOpenEncounter}
              onOpenReferral={onOpenReferral}
              onOpenPrintPreview={() => undefined}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function PrintIcon(): React.JSX.Element {
  return (
    <svg className="patient-report-print-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
    </svg>
  )
}

function formatPatientBirth(patient: PublicPatientSummary): string {
  if (patient.dateOfBirth !== null) return formatLocalDate(patient.dateOfBirth)
  if (patient.approximateAgeYears === null) return 'Not recorded'
  return `Approximately ${patient.approximateAgeYears} years`
}

function formatPatientLocation(patient: PublicPatientSummary): string {
  return [patient.village, patient.quarter].filter((value) => value !== null).join(' / ') || '-'
}

function formatLocalDate(value: string): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  )
}

function printReport(fileName: string): void {
  const previousTitle = document.title
  document.title = fileName
  window.print()
  document.title = previousTitle
}
