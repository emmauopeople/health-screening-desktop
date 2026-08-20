import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type {
  EncounterManagementFlagCategory,
  HealthScreeningApi,
  PublicManagedEncounterDetail,
  PublicManagedEncounterSummary,
  PublicPatientDetail,
  PublicScreeningEncounterStartSummary,
  ScreeningSessionErrorCode
} from '@shared/ipc'

interface Props {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: ScreeningSessionErrorCode): void
  onResumeDraft(
    patient: PublicPatientDetail,
    encounter: PublicScreeningEncounterStartSummary
  ): boolean
}

type LoadState = 'LOADING' | 'READY' | 'ERROR'

const flagCategories: readonly { value: EncounterManagementFlagCategory; label: string }[] = [
  { value: 'POSSIBLE_DATA_ERROR', label: 'Possible data error' },
  { value: 'MISSING_INFORMATION', label: 'Missing information' },
  { value: 'WRONG_PATIENT', label: 'Possible wrong patient' },
  { value: 'DUPLICATE_ENCOUNTER', label: 'Possible duplicate encounter' },
  { value: 'OTHER', label: 'Other concern' }
]

export function ManageEncountersWorkspace({
  api,
  headingId,
  headingRef,
  onAuthenticationFailure,
  onResumeDraft
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | PublicManagedEncounterSummary['status']>(
    'ALL'
  )
  const [items, setItems] = useState<readonly PublicManagedEncounterSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<PublicManagedEncounterDetail | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('LOADING')
  const [message, setMessage] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [flagCategory, setFlagCategory] =
    useState<EncounterManagementFlagCategory>('POSSIBLE_DATA_ERROR')
  const [flagDescription, setFlagDescription] = useState('')
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [showVoidForm, setShowVoidForm] = useState(false)
  const management = api.screeningEncounters.management
  const selectedIdRef = useRef<string | null>(null)
  const searchRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const previousCriteriaRef = useRef({ query: '', status: 'ALL', initialized: false })
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null)

  const handleControlledFailure = useCallback(
    (status: string): void => {
      if (status === 'AUTHENTICATION_REQUIRED' || status === 'FORBIDDEN') {
        onAuthenticationFailure(
          status === 'FORBIDDEN' ? 'AUTHORIZATION_FAILED' : 'AUTH_UNAUTHENTICATED'
        )
        return
      }
      setMessage(
        status === 'VALIDATION_FAILED'
          ? 'Check the information and try again.'
          : 'Encounter information is unavailable.'
      )
    },
    [onAuthenticationFailure]
  )

  const loadDetail = useCallback(
    async (encounterId: string): Promise<void> => {
      const requestId = detailRequestRef.current + 1
      detailRequestRef.current = requestId
      const result = await management.getDetail({ encounterId })
      if (detailRequestRef.current !== requestId) return
      if (!result.ok) {
        setMessage('Encounter information is unavailable.')
        return
      }
      if (result.data.status !== 'LOADED') {
        handleControlledFailure(result.data.status)
        return
      }
      setDetail(result.data.detail)
      setSelectedId(encounterId)
      selectedIdRef.current = encounterId
      setShowVoidForm(false)
      setVoidReason('')
    },
    [handleControlledFailure, management]
  )

  const search = useCallback(
    async (
      nextQuery: string,
      nextStatus: 'ALL' | PublicManagedEncounterSummary['status']
    ): Promise<void> => {
      const requestId = searchRequestRef.current + 1
      searchRequestRef.current = requestId
      setLoadState('LOADING')
      setMessage(null)
      const result = await management.search({
        query: nextQuery,
        status: nextStatus,
        page: 1,
        pageSize: 50
      })
      if (searchRequestRef.current !== requestId) return
      if (!result.ok) {
        setLoadState('ERROR')
        setMessage('Encounters are unavailable.')
        return
      }
      if (result.data.status !== 'LOADED') {
        setLoadState('ERROR')
        handleControlledFailure(result.data.status)
        return
      }
      setItems(result.data.items)
      setLoadState('READY')
      const currentSelectedId = selectedIdRef.current
      const nextSelectedId = result.data.items.some((item) => item.id === currentSelectedId)
        ? currentSelectedId
        : (result.data.items[0]?.id ?? null)
      if (nextSelectedId === null) {
        setSelectedId(null)
        selectedIdRef.current = null
        setDetail(null)
      } else {
        await loadDetail(nextSelectedId)
      }
    },
    [handleControlledFailure, loadDetail, management]
  )

  useEffect(() => {
    const previous = previousCriteriaRef.current
    const normalizedQuery = query.trim()
    const queryChanged = previous.query !== query
    const statusChanged = previous.status !== statusFilter
    previousCriteriaRef.current = { query, status: statusFilter, initialized: true }

    if (
      previous.initialized &&
      queryChanged &&
      !statusChanged &&
      normalizedQuery.length > 0 &&
      normalizedQuery.length < 3
    )
      return

    const effectiveQuery = normalizedQuery.length >= 3 ? normalizedQuery : ''
    const delay = previous.initialized && queryChanged && !statusChanged ? 300 : 0
    const timer = window.setTimeout(() => {
      void search(effectiveQuery, statusFilter)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [query, search, statusFilter])

  const refresh = async (): Promise<void> => {
    await search(query.trim().length >= 3 ? query.trim() : '', statusFilter)
  }

  const resumeDraft = async (): Promise<void> => {
    if (detail === null || detail.encounter.status !== 'DRAFT') return
    setSaving(true)
    const patientResult = await api.patient.get({ patientId: detail.encounter.patientId })
    setSaving(false)
    if (!patientResult.ok) {
      setMessage('Patient information is unavailable.')
      return
    }
    const opened = onResumeDraft(patientResult.data, {
      id: detail.encounter.id,
      patientId: detail.encounter.patientId,
      screeningSessionId: detail.encounter.screeningSessionId,
      status: 'DRAFT',
      startedAt: detail.encounter.startedAt,
      recordVersion: detail.encounter.recordVersion
    })
    if (!opened) setMessage('Close one patient screening to resume this draft.')
  }

  const voidEmptyDraft = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (detail === null || detail.encounter.status !== 'DRAFT' || voidReason.trim() === '') return
    setSaving(true)
    const result = await management.voidEmptyDraft({
      encounterId: detail.encounter.id,
      expectedVersion: detail.encounter.recordVersion,
      reason: voidReason
    })
    setSaving(false)
    if (!result.ok || result.data.status !== 'VOIDED') {
      const status = result.ok ? result.data.status : 'UNAVAILABLE'
      setMessage(
        status === 'ENCOUNTER_NOT_EMPTY'
          ? 'This draft contains screening data and cannot be voided here.'
          : status === 'VERSION_CONFLICT'
            ? 'This encounter changed. Review it and try again.'
            : 'The draft could not be voided.'
      )
      return
    }
    setVoidReason('')
    setShowVoidForm(false)
    await search(query.trim().length >= 3 ? query.trim() : '', statusFilter)
    setMessage('Empty draft voided')
  }

  const addNote = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (selectedId === null || noteText.trim() === '') return
    setSaving(true)
    const result = await api.screeningEncounters.management.addAddendum({
      encounterId: selectedId,
      noteText
    })
    setSaving(false)
    if (!result.ok || result.data.status !== 'ADDED') {
      handleControlledFailure(result.ok ? result.data.status : 'UNAVAILABLE')
      return
    }
    setNoteText('')
    await refresh()
    setMessage('Note added')
  }

  const openFlag = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (selectedId === null || flagDescription.trim() === '') return
    setSaving(true)
    const result = await api.screeningEncounters.management.openFlag({
      encounterId: selectedId,
      category: flagCategory,
      description: flagDescription
    })
    setSaving(false)
    if (!result.ok || result.data.status !== 'OPENED') {
      handleControlledFailure(result.ok ? result.data.status : 'UNAVAILABLE')
      return
    }
    setFlagDescription('')
    await refresh()
    setMessage('Concern flagged for review')
  }

  const resolveFlag = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (selectedId === null || resolvingFlagId === null || resolutionNote.trim() === '') return
    setSaving(true)
    const result = await api.screeningEncounters.management.resolveFlag({
      encounterId: selectedId,
      flagId: resolvingFlagId,
      status: 'RESOLVED',
      resolutionNote
    })
    setSaving(false)
    if (!result.ok || result.data.status !== 'UPDATED') {
      handleControlledFailure(result.ok ? result.data.status : 'UNAVAILABLE')
      return
    }
    setResolvingFlagId(null)
    setResolutionNote('')
    await refresh()
    setMessage('Concern resolved')
  }

  const manageable =
    detail?.encounter.status === 'COMPLETED' || detail?.encounter.status === 'AMENDED'

  return (
    <section className="manage-encounters-workspace" aria-labelledby={headingId}>
      <div className="application-workspace-heading-row">
        <div>
          <p className="application-workspace-kicker">Screening</p>
          <h1 id={headingId} ref={headingRef} tabIndex={-1}>
            Manage Encounters
          </h1>
        </div>
      </div>

      <div className="manage-encounters-search" role="search">
        <div className="form-field">
          <label htmlFor="manage-encounters-query">Search encounters</label>
          <input
            id="manage-encounters-query"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Patient name, ID, or date of birth"
            aria-describedby="manage-encounters-search-hint"
          />
          <small id="manage-encounters-search-hint">Enter at least 3 characters</small>
        </div>
        <div className="form-field">
          <label htmlFor="manage-encounters-status">Status</label>
          <select
            id="manage-encounters-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="COMPLETED">Completed</option>
            <option value="AMENDED">Amended</option>
            <option value="VOID">Voided</option>
          </select>
        </div>
      </div>

      {message !== null ? (
        <div className="screening-workspace-message" role="status">
          {message}
        </div>
      ) : null}

      <div className="manage-encounters-layout">
        <section className="manage-encounters-results" aria-label="Encounter results">
          {loadState === 'LOADING' ? <p>Loading encounters...</p> : null}
          {loadState === 'READY' && items.length === 0 ? <p>No encounters found.</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`manage-encounter-result${selectedId === item.id ? ' is-selected' : ''}`}
              onClick={() => void loadDetail(item.id)}
            >
              <span className="manage-encounter-result-heading">
                <strong>{item.patientDisplayName}</strong>
                <span className={`status-pill status-${item.status.toLowerCase()}`}>
                  {formatStatus(item.status)}
                </span>
              </span>
              <span>
                {item.patientCode} · {formatDate(item.completedAt ?? item.startedAt)}
              </span>
              <span>{item.locationName}</span>
              {item.status === 'DRAFT' ? (
                <span>
                  {item.hasRecordedData ? 'Draft data saved' : 'No screening data recorded'}
                </span>
              ) : null}
              <span>
                {item.openFlagCount > 0
                  ? `${item.openFlagCount} review concern${item.openFlagCount === 1 ? '' : 's'}`
                  : 'No open concerns'}{' '}
                · {item.noteCount} note{item.noteCount === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </section>

        <section className="manage-encounter-detail" aria-label="Encounter details">
          {detail === null ? (
            <p>Select an encounter.</p>
          ) : (
            <>
              <header className="manage-encounter-detail-header">
                <div>
                  <h2>{detail.encounter.patientDisplayName}</h2>
                  <p>
                    {detail.encounter.patientCode} ·{' '}
                    {formatDate(detail.encounter.completedAt ?? detail.encounter.startedAt)}
                  </p>
                </div>
                <div className="encounter-management-actions">
                  {detail.encounter.status === 'DRAFT' ? (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={saving}
                      onClick={() => void resumeDraft()}
                    >
                      Resume screening
                    </button>
                  ) : null}
                  {detail.encounter.status === 'DRAFT' && !detail.encounter.hasRecordedData ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={saving}
                      onClick={() => setShowVoidForm((visible) => !visible)}
                    >
                      Void empty draft
                    </button>
                  ) : null}
                  {manageable ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => {
                        noteInputRef.current?.scrollIntoView({ block: 'center' })
                        noteInputRef.current?.focus()
                      }}
                    >
                      Add note
                    </button>
                  ) : null}
                  <span className={`status-pill status-${detail.encounter.status.toLowerCase()}`}>
                    {formatStatus(detail.encounter.status)}
                  </span>
                </div>
              </header>

              {showVoidForm &&
              detail.encounter.status === 'DRAFT' &&
              !detail.encounter.hasRecordedData ? (
                <form
                  className="encounter-management-form manage-encounter-void-form"
                  onSubmit={voidEmptyDraft}
                >
                  <label htmlFor="encounter-void-reason">Reason for voiding this empty draft</label>
                  <textarea
                    id="encounter-void-reason"
                    rows={2}
                    maxLength={500}
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.currentTarget.value)}
                  />
                  <div className="encounter-management-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => {
                        setShowVoidForm(false)
                        setVoidReason('')
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving || voidReason.trim() === ''}
                    >
                      Confirm void
                    </button>
                  </div>
                </form>
              ) : null}

              {detail.encounter.status === 'DRAFT' ? (
                <ReviewCard title="Screening draft">
                  <p>
                    {detail.encounter.hasRecordedData
                      ? 'Saved screening data is available. Resume the screening to review or complete it.'
                      : 'No screening data has been recorded. Resume to continue, or void the draft if it was created in error.'}
                  </p>
                </ReviewCard>
              ) : (
                <div className="manage-encounter-clinical-grid">
                  <ReviewCard title="Vitals">
                    {detail.vitals.length === 0 ? (
                      <p>Not recorded</p>
                    ) : (
                      detail.vitals.map((reading) => (
                        <p key={reading.sequenceNumber}>
                          Reading {reading.sequenceNumber}: {reading.systolic}/{reading.diastolic}{' '}
                          mmHg · HR {reading.pulse ?? '—'}
                        </p>
                      ))
                    )}
                  </ReviewCard>
                  <ReviewCard title="Lifestyle">
                    {detail.lifestyle.length === 0 ? (
                      <p>Not recorded</p>
                    ) : (
                      detail.lifestyle.map((entry) => (
                        <p key={`${entry.questionCode}-${entry.responseCode}`}>
                          {formatCode(entry.questionCode)}: {formatCode(entry.responseCode)}
                        </p>
                      ))
                    )}
                  </ReviewCard>
                  <ReviewCard title="Food">
                    {detail.foods.length === 0 ? (
                      <p>None reported</p>
                    ) : (
                      detail.foods.map((food, index) => (
                        <p key={`${food.foodName}-${index}`}>
                          {food.foodName} · {formatCode(food.frequencyCode)}
                          {food.notes ? ` · ${food.notes}` : ''}
                        </p>
                      ))
                    )}
                  </ReviewCard>
                  <ReviewCard title="OTC medications">
                    {detail.otcMedications.length === 0 ? (
                      <p>None reported</p>
                    ) : (
                      detail.otcMedications.map((medication, index) => (
                        <p key={`${medication.productName}-${index}`}>
                          {medication.productName} · {medication.reasonForUse} ·{' '}
                          {formatTaking(medication.currentlyTaking)}
                        </p>
                      ))
                    )}
                  </ReviewCard>
                </div>
              )}

              <ReviewCard title="Notes">
                {detail.addenda.length === 0 ? (
                  <p>No notes added.</p>
                ) : (
                  detail.addenda.map((addendum) => (
                    <article className="encounter-management-entry" key={addendum.id}>
                      <p>{addendum.noteText}</p>
                      <small>
                        {addendum.createdByDisplayName} · {formatDateTime(addendum.createdAt)}
                      </small>
                    </article>
                  ))
                )}
                {manageable ? (
                  <form className="encounter-management-form" onSubmit={addNote}>
                    <label htmlFor="encounter-addendum">Add note</label>
                    <textarea
                      id="encounter-addendum"
                      ref={noteInputRef}
                      rows={3}
                      maxLength={2000}
                      value={noteText}
                      onChange={(event) => setNoteText(event.currentTarget.value)}
                    />
                    <button
                      className="button button-secondary"
                      type="submit"
                      disabled={saving || noteText.trim() === ''}
                    >
                      Add note
                    </button>
                  </form>
                ) : null}
              </ReviewCard>

              <ReviewCard title="Review concerns">
                {detail.flags.length === 0 ? (
                  <p>No concerns flagged.</p>
                ) : (
                  detail.flags.map((flag) => (
                    <article className="encounter-management-entry" key={flag.id}>
                      <div className="manage-encounter-result-heading">
                        <strong>{formatFlagCategory(flag.category)}</strong>
                        <span className={`status-pill status-${flag.status.toLowerCase()}`}>
                          {formatStatus(flag.status)}
                        </span>
                      </div>
                      <p>{flag.description}</p>
                      <small>
                        {flag.openedByDisplayName} · {formatDateTime(flag.openedAt)}
                      </small>
                      {flag.resolutionNote ? <p>Resolution: {flag.resolutionNote}</p> : null}
                      {flag.status === 'OPEN' && manageable ? (
                        resolvingFlagId === flag.id ? (
                          <form className="encounter-management-form" onSubmit={resolveFlag}>
                            <label htmlFor={`flag-resolution-${flag.id}`}>Resolution</label>
                            <textarea
                              id={`flag-resolution-${flag.id}`}
                              rows={2}
                              maxLength={1000}
                              value={resolutionNote}
                              onChange={(event) => setResolutionNote(event.currentTarget.value)}
                            />
                            <div className="encounter-management-actions">
                              <button
                                className="button button-secondary"
                                type="button"
                                onClick={() => {
                                  setResolvingFlagId(null)
                                  setResolutionNote('')
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                className="button button-primary"
                                type="submit"
                                disabled={saving || resolutionNote.trim() === ''}
                              >
                                Resolve
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => setResolvingFlagId(flag.id)}
                          >
                            Resolve concern
                          </button>
                        )
                      ) : null}
                    </article>
                  ))
                )}
                {manageable ? (
                  <form className="encounter-management-form" onSubmit={openFlag}>
                    <label htmlFor="encounter-flag-category">Flag a concern</label>
                    <select
                      id="encounter-flag-category"
                      value={flagCategory}
                      onChange={(event) =>
                        setFlagCategory(
                          event.currentTarget.value as EncounterManagementFlagCategory
                        )
                      }
                    >
                      {flagCategories.map((category) => (
                        <option key={category.value} value={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="encounter-flag-description">Description</label>
                    <textarea
                      id="encounter-flag-description"
                      rows={3}
                      maxLength={1000}
                      value={flagDescription}
                      onChange={(event) => setFlagDescription(event.currentTarget.value)}
                    />
                    <button
                      className="button button-secondary"
                      type="submit"
                      disabled={saving || flagDescription.trim() === ''}
                    >
                      Flag for review
                    </button>
                  </form>
                ) : null}
              </ReviewCard>
            </>
          )}
        </section>
      </div>
    </section>
  )
}

function ReviewCard({
  title,
  children
}: {
  readonly title: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="screening-review-card">
      <h3>{title}</h3>
      {children}
    </section>
  )
}
function formatStatus(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}
function formatCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (character) => character.toUpperCase())
}
function formatFlagCategory(value: EncounterManagementFlagCategory): string {
  return flagCategories.find((category) => category.value === value)?.label ?? formatCode(value)
}
function formatTaking(value: boolean | null): string {
  return value === null
    ? 'Taking status unknown'
    : value
      ? 'Currently taking'
      : 'Not currently taking'
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(new Date(value))
}
function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}
