import { historyInstant, historyTypeLabels } from './central-history-formatting'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  historyReasonCodes,
  historyResourceTypes,
  type HistoryReason,
  type HistoryResourceType
} from '@shared/central-history/contract.mjs'
import {
  centralHistoryMessages,
  type CentralHistoryApi,
  type CentralHistoryReadData,
  type CentralHistoryStatus
} from '@shared/ipc/central-history-contracts'
import { CentralHistoryCard, HistoryFields } from './CentralHistoryCard'
import './central-history.css'

const reasonLabels: Record<HistoryReason, string> = {
  CARE_DELIVERY: 'Care delivery',
  CARE_COORDINATION: 'Care coordination',
  PATIENT_REQUEST: 'Patient request',
  QUALITY_IMPROVEMENT: 'Quality improvement',
  OPERATIONS_SUPPORT: 'Operations support'
}
type SavedHistory = Extract<CentralHistoryReadData, { status: 'READY' }>
interface Props {
  api: CentralHistoryApi | undefined
  patientId: string
  securityEpochRef: MutableRefObject<number>
  registerStateInvalidator(invalidator: () => void): () => void
  onAuthenticationFailure(status: 'UNAUTHENTICATED' | 'FORBIDDEN'): void
}

export function CentralPatientHistoryPanel({
  api,
  patientId,
  securityEpochRef,
  registerStateInvalidator,
  onAuthenticationFailure
}: Props): React.JSX.Element {
  const [reason, setReason] = useState<HistoryReason | ''>('')
  const [fromDate, setFromDate] = useState(() =>
    new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10)
  )
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [kind, setKind] = useState<HistoryResourceType | ''>('')
  const [saved, setSaved] = useState<SavedHistory | null>(null)
  const [previousOffsets, setPreviousOffsets] = useState<number[]>([])
  const [busy, setBusy] = useState<'READ' | 'REFRESH' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const sequence = useRef(0)
  const paused = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  const invalidate = useCallback(() => {
    sequence.current++
    paused.current = true
    setSaved(null)
    setMessage(null)
    setBusy(null)
    setPreviousOffsets([])
  }, [])
  useEffect(() => registerStateInvalidator(invalidate), [registerStateInvalidator, invalidate])
  useEffect(
    () => () => {
      sequence.current++
      paused.current = true
    },
    []
  )

  function top(): void {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }
  function status(value: CentralHistoryStatus): void {
    setMessage(centralHistoryMessages[value])
    if (
      [
        'NO_CACHE',
        'NOT_CONFIGURED',
        'IDENTITY_NOT_READY',
        'ACCESS_DENIED',
        'CACHE_CHANGED',
        'UNAUTHENTICATED',
        'FORBIDDEN'
      ].includes(value)
    ) {
      setSaved(null)
      setPreviousOffsets([])
    }
    if (value === 'UNAUTHENTICATED' || value === 'FORBIDDEN') onAuthenticationFailure(value)
  }
  async function read(offset = 0, resourceType = kind, trail = previousOffsets): Promise<void> {
    if (!api || !reason) return
    const request = ++sequence.current
    const epoch = securityEpochRef.current
    const current = (): boolean =>
      request === sequence.current && epoch === securityEpochRef.current
    setBusy('READ')
    setMessage(null)
    try {
      const result = await api.read({
        patientId,
        reasonCode: reason,
        offset,
        ...(offset > 0 && saved ? { snapshotId: saved.snapshotId } : {}),
        ...(resourceType ? { resourceType } : {})
      })
      if (!current()) return
      if (!result.ok) {
        setSaved(null)
        setMessage(result.error.message)
        return
      }
      if (result.data.status !== 'READY') {
        status(result.data.status)
        return
      }
      setSaved(result.data)
      setPreviousOffsets(offset === 0 ? [] : trail)
    } catch {
      if (current()) {
        setSaved(null)
        status('UNAVAILABLE')
      }
    } finally {
      if (current()) setBusy(null)
    }
  }
  async function refresh(restart: boolean): Promise<void> {
    if (!api || !reason) return
    const request = ++sequence.current
    const epoch = securityEpochRef.current
    const current = (): boolean =>
      request === sequence.current && epoch === securityEpochRef.current
    paused.current = false
    setBusy('REFRESH')
    setMessage('Contacting the central server…')
    let first = true
    try {
      while (current()) {
        const result = await api.refresh({
          patientId,
          reasonCode: reason,
          fromDate,
          toDate,
          restart: first && restart
        })
        first = false
        if (!current()) return
        if (!result.ok) {
          setSaved(null)
          setMessage(result.error.message)
          return
        }
        const data = result.data
        if (data.status !== 'IN_PROGRESS' && data.status !== 'COMPLETE') {
          status(data.status)
          return
        }
        if (data.status === 'COMPLETE') {
          await read(0)
          return
        }
        if (paused.current) {
          setMessage(
            `Download paused after ${data.downloaded} records. Use Continue download to resume.`
          )
          return
        }
        setMessage(`Downloading central history… ${data.downloaded} records received.`)
      }
    } catch {
      if (current()) status('UNAVAILABLE')
    } finally {
      if (current()) setBusy(null)
    }
  }

  return (
    <section className="central-history-panel" aria-busy={busy !== null}>
      <h3 ref={heading} tabIndex={-1}>
        Central history
      </h3>
      <p>
        Read-only history shared by the central server. Saved records are available offline after
        you sign in.
      </p>
      <p className="central-history-source">
        Local records remain in Screening History. Times below use this computer’s timezone; date
        filters use UTC.
      </p>
      {!api ? (
        <p role="status">Central history is unavailable in this application version.</p>
      ) : (
        <>
          <fieldset disabled={busy !== null} className="central-history-controls">
            <legend>History access</legend>
            <label>
              Reason for access
              <select
                value={reason}
                onChange={(event) => {
                  invalidate()
                  setReason(event.target.value as HistoryReason | '')
                }}
              >
                <option value="">Choose a reason</option>
                {historyReasonCodes.map((value) => (
                  <option key={value} value={value}>
                    {reasonLabels[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From date (UTC)
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label>
              To date (UTC)
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <div className="central-history-actions">
              <button type="button" disabled={!reason} onClick={() => void read(0)}>
                View saved history
              </button>
              <button type="button" disabled={!reason} onClick={() => void refresh(true)}>
                Refresh from central
              </button>
              <button type="button" disabled={!reason} onClick={() => void refresh(false)}>
                Continue download
              </button>
            </div>
          </fieldset>
          {busy === 'REFRESH' && (
            <button
              type="button"
              onClick={() => {
                paused.current = true
                setMessage('Pausing after the current page…')
              }}
            >
              Pause download
            </button>
          )}
          {message && (
            <p role="status" className="central-history-message">
              {message}
            </p>
          )}
          <label className="central-history-filter">
            History type
            <select
              value={kind}
              disabled={busy !== null}
              onChange={(event) => {
                const next = event.target.value as HistoryResourceType | ''
                setKind(next)
                setSaved(null)
                setPreviousOffsets([])
                if (reason && saved) void read(0, next, [])
              }}
            >
              <option value="">All history</option>
              {historyResourceTypes.map((value) => (
                <option key={value} value={value}>
                  {historyTypeLabels[value]}
                </option>
              ))}
            </select>
          </label>
          {saved && (
            <div className="central-history-results">
              <div className="central-history-snapshot">
                <strong>
                  {String(saved.page.patient.displayName)} ·{' '}
                  {String(saved.page.patient.chsMedicalId)}
                </strong>
                <p>
                  Retrieved {historyInstant(saved.page.retrievedAt)} · Saved{' '}
                  {historyInstant(saved.savedAt)}
                </p>
                <p>
                  Saved range: {saved.page.fromDate} – {saved.page.toDate} (UTC). Changes recorded
                  after retrieval are not shown until refreshed.
                </p>
                <details>
                  <summary>Central patient details</summary>
                  <HistoryFields data={saved.page.patient} />
                </details>
              </div>
              <p>
                {saved.total === 0
                  ? 'No central records were returned for this saved range and history type.'
                  : `${saved.offset + 1}–${saved.offset + saved.page.items.length} of ${saved.total} records`}
              </p>
              {saved.page.items.map((item) => (
                <CentralHistoryCard key={`${item.resourceType}:${item.resourceId}`} item={item} />
              ))}
              <div className="central-history-actions" aria-label="Central history pages">
                <button
                  type="button"
                  disabled={busy !== null || previousOffsets.length === 0}
                  onClick={() =>
                    void read(previousOffsets.at(-1) ?? 0, kind, previousOffsets.slice(0, -1))
                  }
                >
                  Previous page
                </button>
                <button
                  type="button"
                  disabled={busy !== null || saved.nextOffset === null}
                  onClick={() => {
                    if (saved.nextOffset !== null)
                      void read(saved.nextOffset, kind, [...previousOffsets, saved.offset])
                  }}
                >
                  Next page
                </button>
                <button
                  type="button"
                  onClick={() => {
                    invalidate()
                    top()
                  }}
                >
                  Close history
                </button>
                <button type="button" onClick={top}>
                  ↑ Back to top
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}
