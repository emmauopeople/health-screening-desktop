import type {
  DemographicHistoryItem,
  HistoryLoadState,
  PatientHistoryPageSize
} from './patient-history-state'
import {
  formatDemographicFieldLabel,
  formatDemographicReasonLabel,
  formatHistoryValue,
  formatRowVersionTransition
} from './patient-history-formatting'

interface PatientDemographicHistoryPanelProps {
  readonly state: HistoryLoadState<DemographicHistoryItem>
  onRetry(): void
  onPageChange(page: number): void
  onPageSizeChange(pageSize: PatientHistoryPageSize): void
}

export function PatientDemographicHistoryPanel({
  state,
  onRetry,
  onPageChange,
  onPageSizeChange
}: PatientDemographicHistoryPanelProps): React.JSX.Element {
  const page = getHistoryPage(state)
  const pageSize = getHistoryPageSize(state)
  const total = state.status === 'READY' ? state.total : 0

  return (
    <div className="patient-tab-panel-content">
      <HistoryStatus
        state={state}
        readyText={
          state.status === 'READY'
            ? getHistoryRangeText(page, pageSize, state.total, 'demographic amendments')
            : ''
        }
      />
      {state.status === 'ERROR' ? (
        <button type="button" className="button button-secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {state.status === 'READY' ? (
        <div className="patient-history-list">
          {state.items.map((record) => (
            <article key={record.amendmentId} className="patient-history-record">
              <header className="patient-history-record-header">
                <h3>{formatDemographicReasonLabel(record.reasonCode)}</h3>
                <span>{record.amendedAt}</span>
              </header>
              <dl className="patient-history-meta">
                <DetailRow label="Amended by" value={record.amendedByDisplayName} />
                <DetailRow
                  label="Version"
                  value={formatRowVersionTransition(
                    record.priorRowVersion,
                    record.resultingRowVersion
                  )}
                />
                {record.reasonNote !== null ? (
                  <DetailRow label="Reason note" value={record.reasonNote} />
                ) : null}
              </dl>
              <div className="patient-history-table-scroll">
                <table className="patient-history-table">
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Previous value</th>
                      <th scope="col">New value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.changes.map((change) => (
                      <tr key={change.fieldName}>
                        <td>{formatDemographicFieldLabel(change.fieldName)}</td>
                        <td>{formatHistoryValue(change.previousValue)}</td>
                        <td>{formatHistoryValue(change.newValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <HistoryPagination
        page={page}
        pageSize={pageSize}
        total={total}
        loading={state.status === 'LOADING'}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  )
}

function HistoryStatus({
  state,
  readyText
}: {
  readonly state: HistoryLoadState<DemographicHistoryItem>
  readonly readyText: string
}): React.JSX.Element {
  switch (state.status) {
    case 'IDLE':
      return (
        <p className="patient-history-status" role="status">
          Demographic history is ready to load.
        </p>
      )
    case 'LOADING':
      return (
        <p className="patient-history-status" role="status">
          Loading demographic history.
        </p>
      )
    case 'EMPTY':
      return (
        <p className="patient-history-status" role="status">
          No demographic amendments recorded.
        </p>
      )
    case 'ERROR':
      return (
        <p className="patient-history-status patient-history-error" role="alert">
          {state.message}
        </p>
      )
    case 'READY':
      return (
        <p className="patient-history-status" role="status">
          {readyText}
        </p>
      )
  }
}

function HistoryPagination({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
  onPageSizeChange
}: {
  readonly page: number
  readonly pageSize: PatientHistoryPageSize
  readonly total: number
  readonly loading: boolean
  onPageChange(page: number): void
  onPageSizeChange(pageSize: PatientHistoryPageSize): void
}): React.JSX.Element {
  return (
    <div className="patient-pagination patient-history-pagination">
      <span>
        Page {page} / {Math.max(1, Math.ceil(total / pageSize))}
      </span>
      <button
        type="button"
        className="button button-secondary"
        disabled={loading || page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={loading || page * pageSize >= total}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
      <select
        value={pageSize}
        aria-label="Demographic history page size"
        disabled={loading}
        onChange={(event) => onPageSizeChange(coerceHistoryPageSize(Number(event.target.value)))}
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
    </div>
  )
}

function DetailRow({
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

function getHistoryPage(state: HistoryLoadState<DemographicHistoryItem>): number {
  return state.status === 'IDLE' ? 1 : state.page
}

function getHistoryPageSize(
  state: HistoryLoadState<DemographicHistoryItem>
): PatientHistoryPageSize {
  return state.status === 'IDLE' ? 25 : state.pageSize
}

function getHistoryRangeText(
  page: number,
  pageSize: PatientHistoryPageSize,
  total: number,
  label: string
): string {
  const start = Math.min((page - 1) * pageSize + 1, total)
  const end = Math.min(page * pageSize, total)

  return `Showing ${start}-${end} of ${total} ${label}.`
}

function coerceHistoryPageSize(value: number): PatientHistoryPageSize {
  return value === 50 || value === 100 ? value : 25
}
