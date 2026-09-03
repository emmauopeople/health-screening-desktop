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
  PublicReferralDetail,
  PublicReferralSummary,
  ReferralMedicationChangeType,
  ReferralStatus,
  ReferralTreatmentAction,
  ReferralUrgency
} from '@shared/ipc'

interface ReferralWorklistWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  readonly requestedReferralId?: string | null
  readonly requestedSessionId?: string | null
  onRequestedReferralConsumed?(): void
  onClearRequestedSession?(): void
  onAuthenticationFailure(code: PatientErrorCode): void
  onOpenPatient(patientId: string): void
  onOpenEncounter(encounterId: string): void
}

type StatusFilter = 'ACTIVE' | 'ALL' | ReferralStatus
type DueFilter = 'ALL' | 'OVERDUE' | 'NEXT_14_DAYS' | 'NEXT_30_DAYS'

const activeStatuses: readonly ReferralStatus[] = ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM']
const pageSize = 25 as const

export function ReferralWorklistWorkspace({
  api,
  headingId,
  headingRef,
  requestedReferralId = null,
  requestedSessionId = null,
  onRequestedReferralConsumed,
  onClearRequestedSession,
  onAuthenticationFailure,
  onOpenPatient,
  onOpenEncounter
}: ReferralWorklistWorkspaceProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [urgency, setUrgency] = useState<ReferralUrgency | 'ALL'>('ALL')
  const [dueFilter, setDueFilter] = useState<DueFilter>('ALL')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<readonly PublicReferralSummary[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(requestedReferralId)
  const [detail, setDetail] = useState<PublicReferralDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showFollowup, setShowFollowup] = useState(false)
  const requestIdRef = useRef(0)
  const requestedReferralIdRef = useRef<string | null>(requestedReferralId)

  const dates = useMemo(() => resolveDueRange(dueFilter), [dueFilter])

  const handleControlledFailure = useCallback(
    (status: string): void => {
      if (status === 'AUTHENTICATION_REQUIRED') {
        onAuthenticationFailure('AUTH_UNAUTHENTICATED')
      } else if (status === 'FORBIDDEN') {
        onAuthenticationFailure('AUTHORIZATION_FAILED')
      }
    },
    [onAuthenticationFailure]
  )

  const loadDetail = useCallback(
    async (referralId: string): Promise<void> => {
      setDetailLoading(true)
      const result = await api.referrals.getDetail({ referralId })
      if (!result.ok) {
        if (result.error.code === 'IPC_FORBIDDEN') onAuthenticationFailure('IPC_FORBIDDEN')
        setMessage(result.error.message)
        setDetail(null)
      } else if (result.data.status === 'LOADED') {
        setDetail(result.data.detail)
        setMessage(null)
      } else {
        handleControlledFailure(result.data.status)
        setMessage(messageForStatus(result.data.status))
        setDetail(null)
      }
      setDetailLoading(false)
    },
    [api, handleControlledFailure, onAuthenticationFailure]
  )

  const load = useCallback(
    async (requestedPage: number): Promise<void> => {
      const normalized = query.trim()
      if (normalized.length > 0 && normalized.length < 3) return
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setLoading(true)
      const result = await api.referrals.search({
        query: normalized,
        screeningSessionId: requestedSessionId,
        statuses:
          statusFilter === 'ACTIVE'
            ? [...activeStatuses]
            : statusFilter === 'ALL'
              ? []
              : [statusFilter],
        urgency: urgency === 'ALL' ? null : urgency,
        dueFrom: dates.from,
        dueTo: dates.to,
        page: requestedPage,
        pageSize
      })
      if (requestIdRef.current !== requestId) return
      if (!result.ok) {
        if (result.error.code === 'IPC_FORBIDDEN') onAuthenticationFailure('IPC_FORBIDDEN')
        setItems([])
        setTotal(0)
        setMessage(result.error.message)
      } else if (result.data.status === 'LOADED') {
        const loaded = result.data
        setItems(loaded.items)
        setTotal(loaded.total)
        setPage(loaded.page)
        setMessage(null)
        if (loaded.items.length === 0 && requestedReferralIdRef.current === null) setDetail(null)
        setSelectedId((current) => {
          if (requestedReferralIdRef.current !== null) {
            const exactReferralId = requestedReferralIdRef.current
            requestedReferralIdRef.current = null
            return exactReferralId
          }
          if (current !== null && loaded.items.some((item) => item.id === current)) {
            return current
          }
          return loaded.items[0]?.id ?? null
        })
      } else {
        handleControlledFailure(result.data.status)
        setItems([])
        setTotal(0)
        setMessage(messageForStatus(result.data.status))
      }
      setLoading(false)
    },
    [
      api,
      dates.from,
      dates.to,
      handleControlledFailure,
      onAuthenticationFailure,
      query,
      requestedSessionId,
      statusFilter,
      urgency
    ]
  )

  useEffect(() => {
    const normalized = query.trim()
    if (normalized.length > 0 && normalized.length < 3) return
    const timeout = window.setTimeout(() => void load(1), normalized.length === 0 ? 0 : 250)
    return () => window.clearTimeout(timeout)
  }, [load, query, statusFilter, urgency, dueFilter])

  useEffect(() => {
    if (requestedReferralId === null) return
    requestedReferralIdRef.current = requestedReferralId
    onRequestedReferralConsumed?.()
  }, [onRequestedReferralConsumed, requestedReferralId])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(async () => {
      if (active && selectedId !== null) await loadDetail(selectedId)
    })
    return () => {
      active = false
    }
  }, [loadDetail, selectedId])

  useEffect(
    () => () => {
      requestIdRef.current += 1
    },
    []
  )

  const search = (event: FormEvent): void => {
    event.preventDefault()
    void load(1)
  }

  const updateStatus = async (status: ReferralStatus, reason: string | null): Promise<void> => {
    if (detail === null) return
    setMutating(true)
    const result = await api.referrals.updateStatus({
      referralId: detail.id,
      expectedVersion: detail.recordVersion,
      status,
      reason
    })
    await reconcileMutation(result, detail.id)
  }

  const reconcileMutation = async (
    result: Awaited<ReturnType<HealthScreeningApi['referrals']['updateStatus']>>,
    referralId: string
  ): Promise<void> => {
    if (!result.ok) {
      if (result.error.code === 'IPC_FORBIDDEN') onAuthenticationFailure('IPC_FORBIDDEN')
      setMessage(result.error.message)
    } else if (result.data.status === 'UPDATED') {
      setDetail(result.data.detail)
      setMessage(null)
      setShowFollowup(false)
      await load(page)
    } else {
      handleControlledFailure(result.data.status)
      setMessage(messageForStatus(result.data.status))
      if (result.data.status === 'VERSION_CONFLICT') await loadDetail(referralId)
    }
    setMutating(false)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)

  return (
    <section className="referral-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading referral-workspace-heading">
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Referral Worklist
        </h1>
      </header>

      {requestedSessionId === null ? null : (
        <div className="referral-session-filter" role="status">
          <span>Showing referrals for the selected screening session.</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClearRequestedSession}
          >
            Show all referrals
          </button>
        </div>
      )}

      <form className="referral-filters" onSubmit={search}>
        <div className="referral-search-group">
          <label className="visually-hidden" htmlFor="referral-search">
            Search referrals
          </label>
          <input
            id="referral-search"
            type="search"
            value={query}
            placeholder="Search patient name or code"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button className="button button-primary" type="submit" disabled={loading}>
            Search
          </button>
        </div>
        <label>
          <span>Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as StatusFilter)}
          >
            <option value="ACTIVE">Active</option>
            <option value="ALL">All</option>
            <option value="OPEN">Open</option>
            <option value="CONTACTED">Contacted</option>
            <option value="SEEN">Seen</option>
            <option value="UNABLE_TO_CONFIRM">Unable to confirm</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <label>
          <span>Urgency</span>
          <select
            value={urgency}
            onChange={(event) => setUrgency(event.currentTarget.value as ReferralUrgency | 'ALL')}
          >
            <option value="ALL">All</option>
            <option value="URGENT">Urgent</option>
            <option value="STANDARD">Standard</option>
          </select>
        </label>
        <label>
          <span>Due</span>
          <select
            value={dueFilter}
            onChange={(event) => setDueFilter(event.currentTarget.value as DueFilter)}
          >
            <option value="ALL">All dates</option>
            <option value="OVERDUE">Overdue</option>
            <option value="NEXT_14_DAYS">Next 14 days</option>
            <option value="NEXT_30_DAYS">Next 30 days</option>
          </select>
        </label>
        <button
          className="button button-secondary referral-clear-button"
          type="button"
          onClick={() => {
            setQuery('')
            setStatusFilter('ACTIVE')
            setUrgency('ALL')
            setDueFilter('ALL')
          }}
        >
          Clear
        </button>
      </form>

      {message === null ? null : (
        <p className="referral-message" role="alert">
          {message}
        </p>
      )}

      <div className="referral-split-pane">
        <section className="referral-list-pane" aria-labelledby="referral-list-title">
          <h2 id="referral-list-title">{total} referrals</h2>
          <div className="referral-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Due date</th>
                  <th>Patient</th>
                  <th>Urgency</th>
                  <th>Status</th>
                  <th>Last contact</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>{loading ? 'Loading referrals...' : 'No referrals found.'}</td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      aria-selected={item.id === selectedId}
                      className={item.id === selectedId ? 'is-selected' : undefined}
                      onClick={() => {
                        requestedReferralIdRef.current = null
                        setSelectedId(item.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          requestedReferralIdRef.current = null
                          setSelectedId(item.id)
                        }
                      }}
                    >
                      <td>{formatDate(item.dueDate)}</td>
                      <td>
                        <strong>{item.patientDisplayName}</strong>
                        <small>{item.patientCode}</small>
                      </td>
                      <td>
                        <span className="referral-badge" data-urgency={item.urgency}>
                          {formatLabel(item.urgency)}
                        </span>
                      </td>
                      <td>{formatLabel(item.status)}</td>
                      <td>
                        {item.lastContactDate === null ? 'None' : formatDate(item.lastContactDate)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <footer className="referral-pagination">
            <span>
              Showing {first}–{last} of {total}
            </span>
            <div>
              <button
                type="button"
                className="button button-secondary"
                disabled={loading || page <= 1}
                onClick={() => void load(page - 1)}
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
                onClick={() => void load(page + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        </section>

        <section className="referral-detail-pane" aria-labelledby="referral-detail-title">
          <h2 id="referral-detail-title">Selected referral</h2>
          {detailLoading ? (
            <p>Loading referral...</p>
          ) : detail === null ? (
            <p>Select a referral to view details.</p>
          ) : (
            <ReferralDetail
              key={`${detail.id}:${detail.recordVersion}`}
              detail={detail}
              disabled={mutating}
              showFollowup={showFollowup}
              onShowFollowup={setShowFollowup}
              onOpenPatient={() => onOpenPatient(detail.patientId)}
              onOpenEncounter={() => onOpenEncounter(detail.encounterId)}
              onUpdateStatus={(status, reason) => void updateStatus(status, reason)}
              onRecordFollowup={(request) => {
                setMutating(true)
                void api.referrals
                  .recordFollowup({
                    ...request,
                    referralId: detail.id,
                    expectedVersion: detail.recordVersion
                  })
                  .then((result) => reconcileMutation(result, detail.id))
              }}
            />
          )}
        </section>
      </div>
    </section>
  )
}

interface ReferralDetailProps {
  readonly detail: PublicReferralDetail
  readonly disabled: boolean
  readonly showFollowup: boolean
  onShowFollowup(value: boolean): void
  onOpenPatient(): void
  onOpenEncounter(): void
  onUpdateStatus(status: ReferralStatus, reason: string | null): void
  onRecordFollowup(
    request: Omit<
      Parameters<HealthScreeningApi['referrals']['recordFollowup']>[0],
      'referralId' | 'expectedVersion'
    >
  ): void
}

function ReferralDetail({
  detail,
  disabled,
  showFollowup,
  onShowFollowup,
  onOpenPatient,
  onOpenEncounter,
  onUpdateStatus,
  onRecordFollowup
}: ReferralDetailProps): React.JSX.Element {
  const [nextStatus, setNextStatus] = useState<ReferralStatus>(detail.status)
  const [statusReason, setStatusReason] = useState('')

  return (
    <div className="referral-detail-content">
      <div className="referral-detail-title-row">
        <div>
          <strong>{detail.patientDisplayName}</strong>
          <span>{detail.patientCode}</span>
        </div>
        <span className="referral-badge" data-urgency={detail.urgency}>
          {formatLabel(detail.urgency)}
        </span>
      </div>
      <p>
        Created {formatTimestamp(detail.createdAt)} • Due {formatDate(detail.dueDate)}
      </p>
      <div className="referral-reason">
        <span>Referral reason</span>
        <strong>{formatReferralReason(detail)}</strong>
        {detail.destinationName === null ? null : (
          <small>Destination: {detail.destinationName}</small>
        )}
      </div>
      <div className="referral-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={disabled || detail.status === 'CLOSED'}
          onClick={() => onShowFollowup(!showFollowup)}
        >
          Record follow-up
        </button>
        <button type="button" className="button button-secondary" onClick={onOpenPatient}>
          Open patient
        </button>
        <button type="button" className="button button-secondary" onClick={onOpenEncounter}>
          Open screening
        </button>
      </div>
      {showFollowup ? (
        <FollowupForm
          disabled={disabled}
          onCancel={() => onShowFollowup(false)}
          onSubmit={onRecordFollowup}
        />
      ) : null}
      <section className="referral-status-action" aria-labelledby="referral-status-action-title">
        <h3 id="referral-status-action-title">Update status</h3>
        <select
          value={nextStatus}
          disabled={disabled || detail.status === 'CLOSED'}
          onChange={(event) => setNextStatus(event.currentTarget.value as ReferralStatus)}
        >
          {activeStatuses.map((status) => (
            <option key={status} value={status}>
              {formatLabel(status)}
            </option>
          ))}
          <option value="CLOSED">Closed</option>
        </select>
        <input
          value={statusReason}
          maxLength={1000}
          placeholder={nextStatus === 'CLOSED' ? 'Closure reason (required)' : 'Reason (optional)'}
          onChange={(event) => setStatusReason(event.currentTarget.value)}
        />
        <button
          type="button"
          className="button button-secondary"
          disabled={
            disabled ||
            detail.status === 'CLOSED' ||
            nextStatus === detail.status ||
            (nextStatus === 'CLOSED' && statusReason.trim().length === 0)
          }
          onClick={() => onUpdateStatus(nextStatus, statusReason.trim() || null)}
        >
          Save status
        </button>
      </section>
      <History detail={detail} />
    </div>
  )
}

function FollowupForm({
  disabled,
  onCancel,
  onSubmit
}: {
  readonly disabled: boolean
  onCancel(): void
  onSubmit(
    request: ReferralDetailProps['onRecordFollowup'] extends (request: infer T) => void ? T : never
  ): void
}): React.JSX.Element {
  const today = dateOnly(new Date())
  const [contactDate, setContactDate] = useState(today)
  const [contactMethod, setContactMethod] = useState('PHONE')
  const [informationSource, setInformationSource] = useState('PATIENT')
  const [providerSeen, setProviderSeen] = useState('UNKNOWN')
  const [outcome, setOutcome] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextFollowupDate, setNextFollowupDate] = useState('')
  const [newStatus, setNewStatus] = useState<ReferralStatus | 'NONE'>('CONTACTED')
  const [treatmentActions, setTreatmentActions] = useState<readonly ReferralTreatmentAction[]>([])
  const [medicationChanges, setMedicationChanges] = useState<readonly MedicationChangeDraft[]>([])
  const nextMedicationIdRef = useRef(1)

  const toggleAction = (action: ReferralTreatmentAction, checked: boolean): void => {
    setTreatmentActions((current) =>
      checked ? [...current, action] : current.filter((candidate) => candidate !== action)
    )
    if (action === 'TREATMENT_INITIATED') return
    setMedicationChanges((current) => {
      if (!checked) return current.filter((row) => row.changeType !== action)
      if (current.some((row) => row.changeType === action)) return current
      return [...current, newMedicationDraft(action, nextMedicationIdRef.current++)]
    })
  }

  const updateMedication = (id: number, values: Partial<MedicationChangeDraft>): void => {
    setMedicationChanges((current) =>
      current.map((row) => (row.id === id ? { ...row, ...values } : row))
    )
  }

  return (
    <form
      className="referral-followup-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          contactDate,
          contactMethod,
          informationSource,
          providerSeen: providerSeen === 'UNKNOWN' ? null : providerSeen === 'YES',
          facilityName: null,
          dateSeen: null,
          reportedOutcome: outcome.trim() || null,
          reportedMedicationsOrAdvice: null,
          nextAction: nextAction.trim() || null,
          nextFollowupDate: nextFollowupDate || null,
          sourceType: 'DIRECT_FOLLOWUP',
          treatmentActions: [...treatmentActions],
          medicationChanges: medicationChanges.map(
            ({ changeType, medicationName, dosage, frequency }) => ({
              changeType,
              medicationName: medicationName.trim(),
              dosage: dosage.trim() || null,
              frequency: frequency.trim() || null
            })
          ),
          newStatus: newStatus === 'NONE' ? null : newStatus,
          statusReason: null
        })
      }}
    >
      <h3>Record follow-up</h3>
      <label>
        <span>Contact date</span>
        <input
          type="date"
          required
          value={contactDate}
          onChange={(event) => setContactDate(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Contact method</span>
        <select
          value={contactMethod}
          onChange={(event) => setContactMethod(event.currentTarget.value)}
        >
          <option value="PHONE">Phone</option>
          <option value="IN_PERSON">In person</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>
        <span>Information source</span>
        <select
          value={informationSource}
          onChange={(event) => setInformationSource(event.currentTarget.value)}
        >
          <option value="PATIENT">Patient</option>
          <option value="FAMILY">Family</option>
          <option value="PROVIDER">Provider</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label>
        <span>Provider seen</span>
        <select
          value={providerSeen}
          onChange={(event) => {
            const value = event.currentTarget.value
            setProviderSeen(value)
            if (value !== 'YES') {
              setTreatmentActions([])
              setMedicationChanges([])
            }
          }}
        >
          <option value="UNKNOWN">Not confirmed</option>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
        </select>
      </label>
      {providerSeen === 'YES' ? (
        <fieldset className="referral-visit-actions referral-followup-wide">
          <legend>Visit actions</legend>
          {(
            [
              ['TREATMENT_INITIATED', 'Treatment initiated'],
              ['TREATMENT_MODIFIED', 'Treatment modified'],
              ['NEW_MEDICATION', 'New medication']
            ] as const
          ).map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={treatmentActions.includes(value)}
                onChange={(event) => toggleAction(value, event.currentTarget.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
          {medicationChanges.length === 0 ? null : (
            <div className="referral-medication-changes">
              {medicationChanges.map((row) => (
                <div key={row.id} className="referral-medication-row">
                  <div className="referral-medication-row-heading">
                    <strong>
                      {row.changeType === 'NEW_MEDICATION'
                        ? 'New medication'
                        : 'Treatment modified'}
                    </strong>
                    <button
                      type="button"
                      className="button button-secondary referral-medication-remove"
                      onClick={() =>
                        setMedicationChanges((current) =>
                          current.filter((candidate) => candidate.id !== row.id)
                        )
                      }
                      disabled={
                        medicationChanges.filter(
                          (candidate) => candidate.changeType === row.changeType
                        ).length === 1
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <label>
                    <span>Medication *</span>
                    <input
                      required
                      maxLength={255}
                      value={row.medicationName}
                      onChange={(event) =>
                        updateMedication(row.id, { medicationName: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    <span>{row.changeType === 'TREATMENT_MODIFIED' ? 'New dosage' : 'Dosage'}</span>
                    <input
                      maxLength={255}
                      value={row.dosage}
                      onChange={(event) =>
                        updateMedication(row.id, { dosage: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    <span>
                      {row.changeType === 'TREATMENT_MODIFIED' ? 'New frequency' : 'Frequency'}
                    </span>
                    <input
                      maxLength={255}
                      value={row.frequency}
                      onChange={(event) =>
                        updateMedication(row.id, { frequency: event.currentTarget.value })
                      }
                    />
                  </label>
                </div>
              ))}
              {(['NEW_MEDICATION', 'TREATMENT_MODIFIED'] as const).map((changeType) =>
                treatmentActions.includes(changeType) ? (
                  <button
                    key={changeType}
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setMedicationChanges((current) => [
                        ...current,
                        newMedicationDraft(changeType, nextMedicationIdRef.current++)
                      ])
                    }
                  >
                    Add {changeType === 'NEW_MEDICATION' ? 'new medication' : 'modified medication'}
                  </button>
                ) : null
              )}
            </div>
          )}
        </fieldset>
      ) : null}
      <label className="referral-followup-wide">
        <span>Reported outcome</span>
        <textarea
          maxLength={2000}
          value={outcome}
          onChange={(event) => setOutcome(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Next action</span>
        <input
          maxLength={1000}
          value={nextAction}
          onChange={(event) => setNextAction(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>Next follow-up</span>
        <input
          type="date"
          value={nextFollowupDate}
          onChange={(event) => setNextFollowupDate(event.currentTarget.value)}
        />
      </label>
      <label>
        <span>New status</span>
        <select
          value={newStatus}
          onChange={(event) => setNewStatus(event.currentTarget.value as ReferralStatus | 'NONE')}
        >
          <option value="NONE">No change</option>
          <option value="CONTACTED">Contacted</option>
          <option value="SEEN">Seen</option>
          <option value="UNABLE_TO_CONFIRM">Unable to confirm</option>
        </select>
      </label>
      <div className="referral-followup-buttons">
        <button type="submit" className="button button-primary" disabled={disabled}>
          Save follow-up
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

interface MedicationChangeDraft {
  readonly id: number
  readonly changeType: ReferralMedicationChangeType
  readonly medicationName: string
  readonly dosage: string
  readonly frequency: string
}

function newMedicationDraft(
  changeType: ReferralMedicationChangeType,
  id: number
): MedicationChangeDraft {
  return { id, changeType, medicationName: '', dosage: '', frequency: '' }
}

function History({ detail }: { readonly detail: PublicReferralDetail }): React.JSX.Element {
  return (
    <div className="referral-history">
      <section>
        <h3>Status history</h3>
        {detail.statusHistory.length === 0 ? (
          <p>No status history.</p>
        ) : (
          <ol>
            {detail.statusHistory.map((entry) => (
              <li key={entry.id}>
                <strong>{formatLabel(entry.toStatus)}</strong>
                <span>
                  {formatTimestamp(entry.changedAt)} • {entry.changedByDisplayName}
                </span>
                {entry.changeReason === null ? null : <p>{entry.changeReason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h3>Follow-up history</h3>
        {detail.followups.length === 0 ? (
          <p>No follow-up recorded.</p>
        ) : (
          <ol>
            {detail.followups.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {formatDate(entry.contactDate)} • {formatLabel(entry.contactMethod)}
                </strong>
                <span>{entry.recordedByDisplayName}</span>
                {entry.reportedOutcome === null ? null : <p>{entry.reportedOutcome}</p>}
                {entry.treatmentActions.length === 0 ? null : (
                  <p>{entry.treatmentActions.map(formatLabel).join(', ')}</p>
                )}
                {entry.medicationChanges.length === 0 ? null : (
                  <ul className="referral-history-medications">
                    {entry.medicationChanges.map((medication) => (
                      <li key={medication.id}>
                        {formatLabel(medication.changeType)}: {medication.medicationName}
                        {medication.dosage === null ? '' : ` • ${medication.dosage}`}
                        {medication.frequency === null ? '' : ` • ${medication.frequency}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function resolveDueRange(filter: DueFilter): { from: string | null; to: string | null } {
  const today = new Date()
  if (filter === 'ALL') return { from: null, to: null }
  if (filter === 'OVERDUE') {
    const yesterday = new Date(today)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    return { from: null, to: dateOnly(yesterday) }
  }
  const end = new Date(today)
  end.setUTCDate(end.getUTCDate() + (filter === 'NEXT_14_DAYS' ? 14 : 30))
  return { from: dateOnly(today), to: dateOnly(end) }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`)
  )
}
function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}
function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/(^|\s)\S/gu, (letter) => letter.toUpperCase())
}
function formatReferralReason(detail: PublicReferralDetail): string {
  const codedReason = detail.reasonCodes.includes('BP_SCREENING_URGENT_REFERRAL')
    ? 'Urgent blood pressure screening referral'
    : detail.reasonCodes.includes('BP_SCREENING_REFERRAL')
      ? 'Blood pressure screening referral'
      : detail.reasonCodes.map(formatLabel).join(', ')
  const reason = detail.reasonText ?? codedReason
  return detail.triggeringBloodPressure == null
    ? reason
    : `${reason} — BP ${detail.triggeringBloodPressure.systolic}/${detail.triggeringBloodPressure.diastolic} mmHg`
}
function messageForStatus(status: string): string {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return 'Sign in is required.'
    case 'FORBIDDEN':
      return 'You are not authorized to manage referrals.'
    case 'LOCATION_NOT_CONFIGURED':
      return 'Configure this installation location before managing referrals.'
    case 'REFERRAL_NOT_FOUND':
      return 'The referral is no longer available.'
    case 'VERSION_CONFLICT':
      return 'This referral changed. The latest version has been loaded.'
    case 'VALIDATION_FAILED':
      return 'Review the referral information and try again.'
    default:
      return 'Referral information is unavailable. Try again.'
  }
}
