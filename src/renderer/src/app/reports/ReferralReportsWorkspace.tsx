import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  HealthScreeningApi,
  PatientErrorCode,
  PublicPatientSummary,
  PublicReferralDetail,
  ScreeningSessionErrorCode
} from '@shared/ipc'
import { PatientReportDocument, ReferralRecord } from './PatientReportDocument'
import {
  formatReferralReason,
  referralMedicationSummary,
  referralTreatmentSummary
} from './referral-report-format'
import {
  createPrintableReferralReport,
  loadReferralPatientReport,
  type ReferralPatientReportData
} from './referral-report-model'

interface ReferralReportsWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly timeZone: string
  readonly reportedBy: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: PatientErrorCode | ScreeningSessionErrorCode): void
  onOpenEncounter(encounterId: string): void
  onOpenReferral(referralId: string): void
}

interface PatientPage {
  readonly items: readonly PublicPatientSummary[]
  readonly total: number
}

type PatientSearchState =
  | { readonly status: 'LOADING'; readonly previous: PatientPage | null }
  | { readonly status: 'READY'; readonly page: PatientPage }
  | { readonly status: 'ERROR'; readonly message: string; readonly previous: PatientPage | null }

type ReferralReportState =
  | { readonly status: 'IDLE' }
  | { readonly status: 'LOADING'; readonly patient: PublicPatientSummary }
  | { readonly status: 'READY'; readonly data: ReferralPatientReportData }
  | { readonly status: 'ERROR'; readonly patient: PublicPatientSummary; readonly message: string }

type PrintScope = 'SELECTED' | 'ALL'

const patientPageSize = 100

export function ReferralReportsWorkspace({
  api,
  timeZone,
  reportedBy,
  headingId,
  headingRef,
  onAuthenticationFailure,
  onOpenEncounter,
  onOpenReferral
}: ReferralReportsWorkspaceProps): React.JSX.Element {
  const patientRequestRef = useRef(0)
  const reportRequestRef = useRef(0)
  const printButtonRef = useRef<HTMLButtonElement | null>(null)
  const [query, setQuery] = useState('')
  const [patientState, setPatientState] = useState<PatientSearchState>({
    status: 'LOADING',
    previous: null
  })
  const [selectedPatient, setSelectedPatient] = useState<PublicPatientSummary | null>(null)
  const [reportState, setReportState] = useState<ReferralReportState>({ status: 'IDLE' })
  const [selectedReferralId, setSelectedReferralId] = useState<string | null>(null)
  const [printScope, setPrintScope] = useState<PrintScope>('SELECTED')
  const [previewOpen, setPreviewOpen] = useState(false)

  const loadPatients = useCallback(
    async (searchQuery: string): Promise<void> => {
      const normalizedQuery = searchQuery.trim()
      if (normalizedQuery.length > 0 && normalizedQuery.length < 3) return
      const requestId = patientRequestRef.current + 1
      patientRequestRef.current = requestId
      setPatientState((current) => ({
        status: 'LOADING',
        previous: current.status === 'READY' ? current.page : current.previous
      }))
      try {
        const result = await api.patient.search({
          query: normalizedQuery,
          page: 1,
          pageSize: patientPageSize
        })
        if (patientRequestRef.current !== requestId) return
        if (!result.ok) {
          if (result.error.code === 'IPC_FORBIDDEN') {
            onAuthenticationFailure('IPC_FORBIDDEN')
            return
          }
          setPatientState((current) => ({
            status: 'ERROR',
            message: 'Patients could not be loaded for referral reporting.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
          return
        }
        setPatientState({
          status: 'READY',
          page: { items: result.data.items, total: result.data.total }
        })
      } catch {
        if (patientRequestRef.current === requestId) {
          setPatientState((current) => ({
            status: 'ERROR',
            message: 'Patients could not be loaded for referral reporting.',
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
      setPreviewOpen(false)
      setReportState({ status: 'LOADING', patient })
      const result = await loadReferralPatientReport(api, patient)
      if (reportRequestRef.current !== requestId) return
      if (result.status === 'AUTHENTICATION_FAILED') {
        onAuthenticationFailure(result.code)
        return
      }
      if (result.status === 'FAILED') {
        setReportState({ status: 'ERROR', patient, message: result.message })
        return
      }
      setReportState({ status: 'READY', data: result.data })
      setSelectedReferralId(result.data.referrals[0]?.id ?? null)
      setPrintScope('SELECTED')
    },
    [api, onAuthenticationFailure]
  )

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length > 0 && normalizedQuery.length < 3) return
    const timeout = window.setTimeout(
      () => void loadPatients(normalizedQuery),
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
      patientRequestRef.current += 1
      reportRequestRef.current += 1
    },
    []
  )

  const patientPage = patientState.status === 'READY' ? patientState.page : patientState.previous
  const patientOptions = useMemo(() => {
    if (
      selectedPatient === null ||
      patientPage?.items.some((item) => item.id === selectedPatient.id)
    ) {
      return patientPage?.items ?? []
    }
    return [selectedPatient, ...(patientPage?.items ?? [])]
  }, [patientPage, selectedPatient])
  const reportData = reportState.status === 'READY' ? reportState.data : null
  const selectedReferral =
    reportData?.referrals.find((referral) => referral.id === selectedReferralId) ?? null
  const printableReferrals =
    printScope === 'ALL'
      ? (reportData?.referrals ?? [])
      : selectedReferral === null
        ? []
        : [selectedReferral]
  const printableReport =
    reportData === null || printableReferrals.length === 0
      ? null
      : createPrintableReferralReport(reportData, printableReferrals, timeZone)

  const selectPatient = (patientId: string): void => {
    const patient = patientOptions.find((item) => item.id === patientId) ?? null
    setSelectedPatient(patient)
    setSelectedReferralId(null)
    if (patient === null) {
      setReportState({ status: 'IDLE' })
      return
    }
    void loadReport(patient)
  }

  return (
    <section className="referral-reports-workspace" aria-labelledby={headingId}>
      <header className="referral-reports-heading">
        <div>
          <p className="application-workspace-kicker">Patient referral reporting</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Referral Reports
          </h1>
        </div>
      </header>

      <div className="referral-reports-layout">
        <section className="referral-reports-list-panel" aria-label="Patient referral history">
          <div className="referral-reports-patient-selector">
            <label htmlFor="referral-report-patient-search">Search / select patient</label>
            <input
              id="referral-report-patient-search"
              type="search"
              value={query}
              placeholder="Enter at least 3 letters or a patient ID"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <select
              aria-label="Select patient"
              value={selectedPatient?.id ?? ''}
              disabled={patientState.status === 'LOADING' && patientPage === null}
              onChange={(event) => selectPatient(event.currentTarget.value)}
            >
              <option value="">Select a patient</option>
              {patientOptions.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {`${patient.displayName} - ${patient.patientCode}`}
                </option>
              ))}
            </select>
            {query.trim().length > 0 && query.trim().length < 3 ? (
              <span>Enter at least 3 characters to filter the patient dropdown.</span>
            ) : patientState.status === 'ERROR' ? (
              <span role="alert">{patientState.message}</span>
            ) : patientPage !== null && patientPage.total > patientPageSize ? (
              <span>Showing 100 patients. Refine the search to find another patient.</span>
            ) : null}
          </div>

          {reportData === null ? null : (
            <header className="referral-reports-patient-identity">
              <div>
                <span>Patient</span>
                <strong>{reportData.patient.displayName}</strong>
              </div>
              <div>
                <span>Date of birth</span>
                <strong>{formatPatientBirth(reportData.patient)}</strong>
              </div>
              <div>
                <span>Patient ID</span>
                <strong>{reportData.patient.patientCode}</strong>
              </div>
            </header>
          )}

          <div className="referral-reports-list-summary">
            <strong>
              {reportState.status === 'LOADING'
                ? 'Loading referrals...'
                : reportData === null
                  ? 'Select a patient'
                  : `${reportData.referrals.length} referrals`}
            </strong>
          </div>

          <div className="referral-reports-table-scroll">
            <table className="referral-reports-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Treatment</th>
                  <th scope="col">Medication</th>
                </tr>
              </thead>
              <tbody>
                {reportData?.referrals.map((referral) => (
                  <ReferralRow
                    key={referral.id}
                    referral={referral}
                    timeZone={timeZone}
                    selected={referral.id === selectedReferralId}
                    onSelect={() => setSelectedReferralId(referral.id)}
                  />
                ))}
                {reportData !== null && reportData.referrals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="referral-reports-empty">
                      No referrals are recorded for this patient.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="referral-reports-detail-panel" aria-label="Selected referral detail">
          <PrintControls
            scope={printScope}
            referralCount={reportData?.referrals.length ?? 0}
            hasSelectedReferral={selectedReferral !== null}
            onScopeChange={setPrintScope}
            onOpenPreview={() => setPreviewOpen(true)}
          />

          <div className="referral-reports-detail-scroll">
            {reportState.status === 'IDLE' ? (
              <EmptyDetail>Select a patient to review referral history.</EmptyDetail>
            ) : reportState.status === 'LOADING' ? (
              <EmptyDetail>Loading referrals for {reportState.patient.displayName}...</EmptyDetail>
            ) : reportState.status === 'ERROR' ? (
              <div className="referral-reports-error" role="alert">
                <strong>{reportState.message}</strong>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void loadReport(reportState.patient)}
                >
                  Try again
                </button>
              </div>
            ) : selectedReferral === null ? (
              <EmptyDetail>
                {reportState.data.referrals.length === 0
                  ? 'This patient has no recorded referrals.'
                  : 'Select a referral from the table.'}
              </EmptyDetail>
            ) : (
              <ReferralRecord
                referral={selectedReferral}
                timeZone={timeZone}
                interactive
                onOpenEncounter={onOpenEncounter}
                onOpenReferral={onOpenReferral}
              />
            )}
          </div>
        </section>
      </div>

      {previewOpen && printableReport !== null ? (
        <ReferralPrintPreview
          report={printableReport}
          scope={printScope}
          reportedBy={reportedBy}
          timeZone={timeZone}
          printButtonRef={printButtonRef}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </section>
  )
}

function ReferralRow({
  referral,
  timeZone,
  selected,
  onSelect
}: {
  readonly referral: PublicReferralDetail
  readonly timeZone: string
  readonly selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <tr
      className={selected ? 'is-selected' : undefined}
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <td>{formatTimestamp(referral.createdAt, timeZone)}</td>
      <td>{formatReferralReason(referral)}</td>
      <td>
        <strong>{formatCode(referral.status)}</strong>
        <span>{formatCode(referral.urgency)}</span>
      </td>
      <td>{referralTreatmentSummary(referral)}</td>
      <td>{referralMedicationSummary(referral)}</td>
    </tr>
  )
}

function PrintControls({
  scope,
  referralCount,
  hasSelectedReferral,
  onScopeChange,
  onOpenPreview
}: {
  readonly scope: PrintScope
  readonly referralCount: number
  readonly hasSelectedReferral: boolean
  onScopeChange(scope: PrintScope): void
  onOpenPreview(): void
}): React.JSX.Element {
  const canPreview = scope === 'ALL' ? referralCount > 0 : hasSelectedReferral
  return (
    <section
      className="referral-reports-print-controls"
      aria-label="Referral report print controls"
    >
      <div>
        <strong>Print scope</strong>
        <span>Choose what the PDF should contain.</span>
      </div>
      <div className="referral-reports-print-options">
        <label>
          <input
            type="radio"
            name="referral-report-print-scope"
            value="SELECTED"
            checked={scope === 'SELECTED'}
            disabled={!hasSelectedReferral}
            onChange={() => onScopeChange('SELECTED')}
          />
          Selected referral
        </label>
        <label>
          <input
            type="radio"
            name="referral-report-print-scope"
            value="ALL"
            checked={scope === 'ALL'}
            disabled={referralCount === 0}
            onChange={() => onScopeChange('ALL')}
          />
          All patient referrals ({referralCount})
        </label>
      </div>
      <button
        className="button button-primary"
        type="button"
        disabled={!canPreview}
        onClick={onOpenPreview}
      >
        Print preview
      </button>
    </section>
  )
}

function ReferralPrintPreview({
  report,
  scope,
  reportedBy,
  timeZone,
  printButtonRef,
  onClose
}: {
  readonly report: ReturnType<typeof createPrintableReferralReport>
  readonly scope: PrintScope
  readonly reportedBy: string
  readonly timeZone: string
  readonly printButtonRef: RefObject<HTMLButtonElement | null>
  onClose(): void
}): React.JSX.Element {
  return (
    <div className="patient-report-preview-backdrop">
      <section
        className="patient-report-preview-window"
        role="dialog"
        aria-modal="true"
        aria-label="Referral report print preview"
      >
        <header className="patient-report-preview-toolbar">
          <div>
            <strong>Referral report print preview</strong>
            <span>
              {scope === 'ALL'
                ? `All ${report.referrals.length} referrals for ${report.patient.displayName}`
                : `Selected referral for ${report.patient.displayName}`}
            </span>
          </div>
          <div>
            <button
              ref={printButtonRef}
              className="button button-primary"
              type="button"
              onClick={() =>
                printReport(
                  `CHS-referral-report-${report.patient.patientCode}-${scope.toLowerCase()}`
                )
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
              reportedBy={reportedBy}
              preview
              onOpenEncounter={() => undefined}
              onOpenReferral={() => undefined}
              onOpenPrintPreview={() => undefined}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function EmptyDetail({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="referral-reports-empty-detail">{children}</div>
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

function formatTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone }).format(new Date(value))
}

function formatLocalDate(value: string): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  )
}

function formatCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

function printReport(fileName: string): void {
  const previousTitle = document.title
  document.title = fileName
  window.print()
  document.title = previousTitle
}
