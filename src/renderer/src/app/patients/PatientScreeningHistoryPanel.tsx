import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  HealthScreeningApi,
  PublicPatientContextEncounter,
  PublicPatientHistoryEncounter,
  PublicPatientScreeningHistory
} from '@shared/ipc'

type PageSize = 25 | 50 | 100
type LoadState = 'LOADING' | 'READY' | 'ERROR'

interface Props {
  readonly api: HealthScreeningApi
  readonly patientId: string
  onAuthenticationFailure(status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN'): void
  onOpenEncounter(encounterId: string): void
}

export function PatientScreeningHistoryPanel({
  api,
  patientId,
  onAuthenticationFailure,
  onOpenEncounter
}: Props): React.JSX.Element {
  const [history, setHistory] = useState<PublicPatientScreeningHistory | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('LOADING')
  const [message, setMessage] = useState<string | null>(null)
  const requestRef = useRef(0)

  const load = useCallback(
    async (page: number, pageSize: PageSize): Promise<void> => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setLoadState('LOADING')
      setMessage(null)

      try {
        const result = await api.screeningEncounters.management.getPatientHistory({
          patientId,
          page,
          pageSize
        })
        if (requestRef.current !== requestId) return
        if (!result.ok) {
          setLoadState('ERROR')
          setMessage('Screening history is unavailable.')
          return
        }
        if (
          result.data.status === 'AUTHENTICATION_REQUIRED' ||
          result.data.status === 'FORBIDDEN'
        ) {
          onAuthenticationFailure(result.data.status)
          return
        }
        if (result.data.status !== 'LOADED') {
          setLoadState('ERROR')
          setMessage(
            result.data.status === 'PATIENT_NOT_FOUND'
              ? 'Patient screening history was not found.'
              : 'Screening history is unavailable.'
          )
          return
        }

        const loadedHistory = result.data.history
        setHistory(loadedHistory)
        setSelectedId((current) =>
          loadedHistory.items.some((item) => item.id === current)
            ? current
            : (loadedHistory.items[0]?.id ?? null)
        )
        setLoadState('READY')
      } catch {
        if (requestRef.current === requestId) {
          setLoadState('ERROR')
          setMessage('The desktop service is unavailable.')
        }
      }
    },
    [api, onAuthenticationFailure, patientId]
  )

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(1, 25)
    })
    return () => {
      cancelled = true
      requestRef.current += 1
    }
  }, [load])

  if (loadState === 'LOADING' && history === null) {
    return <p className="patient-history-status">Loading screening history…</p>
  }
  if (loadState === 'ERROR' && history === null) {
    return (
      <div className="patient-history-error-state">
        <p className="patient-history-status patient-history-error">{message}</p>
        <button className="button button-secondary" type="button" onClick={() => void load(1, 25)}>
          Retry
        </button>
      </div>
    )
  }
  if (history === null)
    return <p className="patient-history-status">Screening history unavailable.</p>

  const selected = history.items.find((item) => item.id === selectedId) ?? null
  const pageCount = Math.max(1, Math.ceil(history.total / history.pageSize))

  return (
    <div className="patient-screening-history">
      <div className="patient-screening-history-summary">
        <section aria-labelledby="patient-history-average-title">
          <h3 id="patient-history-average-title">30-day average BP</h3>
          <strong>
            {history.thirtyDayAverage === null
              ? '—'
              : `${history.thirtyDayAverage.systolic} / ${history.thirtyDayAverage.diastolic}`}
          </strong>
          <span>
            {history.thirtyDayAverage === null
              ? 'No readings'
              : `${history.thirtyDayAverage.encounterCount} ${history.thirtyDayAverage.encounterCount === 1 ? 'screening' : 'screenings'} • mmHg`}
          </span>
        </section>
        <section aria-labelledby="patient-history-total-title">
          <h3 id="patient-history-total-title">Completed screenings</h3>
          <strong>{history.total}</strong>
          <span>Finalized records</span>
        </section>
      </div>

      <div className="patient-screening-history-charts">
        <TrendChart title="Blood pressure trend" encounters={history.trendEncounters} kind="BP" />
        <TrendChart title="Weight trend" encounters={history.trendEncounters} kind="WEIGHT" />
      </div>

      {history.items.length === 0 ? (
        <p className="patient-history-status">No completed screenings.</p>
      ) : (
        <div className="patient-screening-history-split">
          <section className="patient-screening-history-list" aria-label="Completed screenings">
            <div className="patient-history-table-scroll">
              <table className="patient-history-table patient-screening-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">BP</th>
                    <th scope="col">Pulse</th>
                    <th scope="col">Weight</th>
                    <th scope="col">Recommendation</th>
                    <th scope="col">Referral</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((encounter) => (
                    <tr
                      key={encounter.id}
                      role="button"
                      tabIndex={0}
                      data-selected={encounter.id === selectedId ? 'true' : 'false'}
                      onClick={() => setSelectedId(encounter.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedId(encounter.id)
                        }
                      }}
                    >
                      <td>{formatDate(encounter.completedAt)}</td>
                      <td>{`${encounter.systolic} / ${encounter.diastolic}`}</td>
                      <td>{encounter.pulse}</td>
                      <td>{encounter.weightKg === null ? '—' : `${encounter.weightKg} kg`}</td>
                      <td>{formatAction(encounter.nextAction)}</td>
                      <td>
                        {encounter.referral === null
                          ? 'None'
                          : formatLabel(encounter.referral.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="patient-pagination patient-history-pagination">
              <button
                className="button button-secondary"
                type="button"
                disabled={history.page <= 1 || loadState === 'LOADING'}
                onClick={() => void load(history.page - 1, history.pageSize)}
              >
                Previous
              </button>
              <span>
                Page {history.page} of {pageCount}
              </span>
              <button
                className="button button-secondary"
                type="button"
                disabled={history.page >= pageCount || loadState === 'LOADING'}
                onClick={() => void load(history.page + 1, history.pageSize)}
              >
                Next
              </button>
              <label>
                Rows
                <select
                  value={history.pageSize}
                  disabled={loadState === 'LOADING'}
                  onChange={(event) => void load(1, Number(event.target.value) as PageSize)}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>
          </section>
          <EncounterHistoryDetail encounter={selected} onOpenEncounter={onOpenEncounter} />
        </div>
      )}
    </div>
  )
}

function TrendChart({
  title,
  encounters,
  kind
}: {
  readonly title: string
  readonly encounters: readonly PublicPatientContextEncounter[]
  readonly kind: 'BP' | 'WEIGHT'
}): React.JSX.Element {
  const points = encounters
    .slice()
    .reverse()
    .filter((item) => kind === 'BP' || item.weightKg !== null)
  return (
    <section className="patient-screening-trend" aria-label={title}>
      <h3>{title}</h3>
      {points.length === 0 ? (
        <p>No readings.</p>
      ) : (
        <div className="patient-screening-trend-points">
          {points.map((item) => (
            <div key={item.id}>
              <strong>
                {kind === 'BP' ? `${item.systolic}/${item.diastolic}` : `${item.weightKg} kg`}
              </strong>
              <span>{formatDate(item.completedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function EncounterHistoryDetail({
  encounter,
  onOpenEncounter
}: {
  readonly encounter: PublicPatientHistoryEncounter | null
  onOpenEncounter(encounterId: string): void
}): React.JSX.Element {
  if (encounter === null) {
    return <aside className="patient-screening-history-detail">Select a screening.</aside>
  }
  const followup = encounter.referral?.latestFollowup ?? null
  return (
    <aside className="patient-screening-history-detail" aria-label="Selected screening details">
      <div className="patient-history-record-header">
        <h3>{formatDate(encounter.completedAt)}</h3>
        <button
          className="button button-secondary button-compact"
          type="button"
          onClick={() => onOpenEncounter(encounter.id)}
        >
          Open encounter
        </button>
      </div>
      <dl className="patient-history-meta">
        <div>
          <dt>Recommendation</dt>
          <dd>{formatAction(encounter.nextAction)}</dd>
        </div>
        <div>
          <dt>Referral status</dt>
          <dd>{encounter.referral === null ? 'None' : formatLabel(encounter.referral.status)}</dd>
        </div>
        <div>
          <dt>Reported outcome</dt>
          <dd>{followup?.reportedOutcome ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Provider seen</dt>
          <dd>
            {followup?.providerSeen === null || followup === null
              ? 'Not recorded'
              : followup.providerSeen
                ? 'Yes'
                : 'No'}
          </dd>
        </div>
      </dl>
      <h4>Treatment actions</h4>
      <p>
        {followup?.treatmentActions.length
          ? followup.treatmentActions.map(formatLabel).join(', ')
          : 'None recorded'}
      </p>
      <h4>Medication changes</h4>
      {followup?.medicationChanges.length ? (
        <ul>
          {followup.medicationChanges.map((change) => (
            <li key={change.id}>
              {formatLabel(change.changeType)}: {change.medicationName}
              {change.dosage === null ? '' : ` • ${change.dosage}`}
              {change.frequency === null ? '' : ` • ${change.frequency}`}
            </li>
          ))}
        </ul>
      ) : (
        <p>None recorded</p>
      )}
    </aside>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value))
}

function formatAction(value: PublicPatientHistoryEncounter['nextAction']): string {
  return value === 'URGENT_REFERRAL'
    ? 'Urgent referral'
    : value === 'REFER'
      ? 'Referral'
      : 'Routine'
}

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}
