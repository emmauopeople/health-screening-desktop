import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  AuditReportApi,
  InstallationSettingsErrorCode,
  PatientErrorCode,
  PublicAuditReportActor,
  PublicAuditReportDeployment,
  PublicAuditReportEvent,
  ScreeningSessionErrorCode
} from '@shared/ipc'

import {
  applyAuditReportFilters,
  auditActorValue,
  auditFilterSummary,
  auditRangeLabel,
  createAuditReportPresetRange,
  createInitialAuditReportFilters,
  formatAuditCode,
  type AppliedAuditReportFilters,
  type AuditReportFilterDraft,
  type AuditReportRangePreset
} from './audit-report-model'

interface AuditReportsWorkspaceProps {
  readonly api: AuditReportApi | undefined
  readonly timeZone: string
  readonly reportedBy: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(
    code: PatientErrorCode | ScreeningSessionErrorCode | InstallationSettingsErrorCode
  ): void
}

interface AuditReportContext {
  readonly deployment: PublicAuditReportDeployment
  readonly actors: readonly PublicAuditReportActor[]
  readonly actions: readonly string[]
  readonly entityTypes: readonly string[]
  readonly hasSystemEvents: boolean
}

interface AuditReportPage {
  readonly items: readonly PublicAuditReportEvent[]
  readonly page: number
  readonly pageSize: 25 | 50 | 100
  readonly total: number
}

type ContextState =
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly context: AuditReportContext }
  | { readonly status: 'ERROR'; readonly message: string }

type PageState =
  | { readonly status: 'LOADING'; readonly previous: AuditReportPage | null }
  | { readonly status: 'READY'; readonly page: AuditReportPage }
  | {
      readonly status: 'ERROR'
      readonly message: string
      readonly previous: AuditReportPage | null
    }

type ControlledAuditStatus =
  'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'VALIDATION_FAILED' | 'UNAVAILABLE'

const rangePresets: readonly {
  readonly value: Exclude<AuditReportRangePreset, 'CUSTOM'>
  readonly label: string
}[] = [
  { value: 'TODAY', label: 'Today' },
  { value: 'LAST_7_DAYS', label: 'Last 7 days' },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'ALL_TIME', label: 'All time' }
]

export function AuditReportsWorkspace({
  api,
  timeZone,
  reportedBy,
  headingId,
  headingRef,
  onAuthenticationFailure
}: AuditReportsWorkspaceProps): React.JSX.Element {
  const initialDraft = useMemo(() => createInitialAuditReportFilters(timeZone), [timeZone])
  const initialApplied = useMemo(
    () => applyAuditReportFilters(initialDraft, timeZone),
    [initialDraft, timeZone]
  )
  const requestRef = useRef(0)
  const printButtonRef = useRef<HTMLButtonElement | null>(null)
  const [contextState, setContextState] = useState<ContextState>({ status: 'LOADING' })
  const [pageState, setPageState] = useState<PageState>({ status: 'LOADING', previous: null })
  const [draft, setDraft] = useState<AuditReportFilterDraft>(initialDraft)
  const [applied, setApplied] = useState<AppliedAuditReportFilters | null>(initialApplied)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filterMessage, setFilterMessage] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<string | null>(null)

  const handleControlledStatus = useCallback(
    (status: ControlledAuditStatus): boolean => {
      if (status === 'AUTHENTICATION_REQUIRED') {
        onAuthenticationFailure('AUTH_UNAUTHENTICATED')
        return true
      }
      if (status === 'FORBIDDEN') {
        onAuthenticationFailure('AUTHORIZATION_FAILED')
        return true
      }
      return false
    },
    [onAuthenticationFailure]
  )

  const loadPage = useCallback(
    async (page: number, filters: AppliedAuditReportFilters): Promise<void> => {
      if (api === undefined) {
        setPageState({
          status: 'ERROR',
          message: 'Audit reporting is unavailable in this build.',
          previous: null
        })
        return
      }
      const requestId = requestRef.current + 1
      requestRef.current = requestId
      setPageState((current) => ({
        status: 'LOADING',
        previous: current.status === 'READY' ? current.page : current.previous
      }))
      try {
        const result = await api.search({ ...filters.request, page })
        if (requestRef.current !== requestId) return
        if (!result.ok) {
          if (result.error.code === 'IPC_FORBIDDEN') {
            onAuthenticationFailure('IPC_FORBIDDEN')
            return
          }
          setPageState((current) => ({
            status: 'ERROR',
            message: 'Audit events could not be loaded.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
          return
        }
        if (result.data.status !== 'LOADED') {
          if (handleControlledStatus(result.data.status)) return
          setPageState((current) => ({
            status: 'ERROR',
            message:
              result.data.status === 'VALIDATION_FAILED'
                ? 'The audit filters were not accepted.'
                : 'Audit events could not be loaded.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
          return
        }
        const nextPage: AuditReportPage = Object.freeze({
          items: Object.freeze(result.data.items),
          page: result.data.page,
          pageSize: result.data.pageSize,
          total: result.data.total
        })
        setPageState({ status: 'READY', page: nextPage })
        setSelectedId((current) =>
          nextPage.items.some((item) => item.id === current)
            ? current
            : (nextPage.items[0]?.id ?? null)
        )
      } catch {
        if (requestRef.current === requestId) {
          setPageState((current) => ({
            status: 'ERROR',
            message: 'Audit events could not be loaded.',
            previous: current.status === 'LOADING' ? current.previous : null
          }))
        }
      }
    },
    [api, handleControlledStatus, onAuthenticationFailure]
  )

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      if (api === undefined || initialApplied === null) {
        if (active) {
          setContextState({
            status: 'ERROR',
            message: 'Audit reporting is unavailable in this build.'
          })
        }
        return
      }
      try {
        const result = await api.getContext()
        if (!active) return
        if (!result.ok) {
          if (result.error.code === 'IPC_FORBIDDEN') {
            onAuthenticationFailure('IPC_FORBIDDEN')
            return
          }
          setContextState({ status: 'ERROR', message: 'Audit report filters could not be loaded.' })
          return
        }
        if (result.data.status !== 'LOADED') {
          if (handleControlledStatus(result.data.status)) return
          setContextState({ status: 'ERROR', message: 'Audit report filters could not be loaded.' })
          return
        }
        setContextState({
          status: 'READY',
          context: Object.freeze({
            deployment: result.data.deployment,
            actors: Object.freeze(result.data.actors),
            actions: Object.freeze(result.data.actions),
            entityTypes: Object.freeze(result.data.entityTypes),
            hasSystemEvents: result.data.hasSystemEvents
          })
        })
        void loadPage(1, initialApplied)
      } catch {
        if (active) {
          setContextState({ status: 'ERROR', message: 'Audit report filters could not be loaded.' })
        }
      }
    }
    void load()
    return () => {
      active = false
      requestRef.current += 1
    }
  }, [api, handleControlledStatus, initialApplied, loadPage, onAuthenticationFailure])

  useEffect(() => {
    if (!previewOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPreviewOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    printButtonRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewOpen])

  const context = contextState.status === 'READY' ? contextState.context : null
  const page = pageState.status === 'READY' ? pageState.page : pageState.previous
  const selected = page?.items.find((item) => item.id === selectedId) ?? null
  const totalPages = Math.max(1, Math.ceil((page?.total ?? 0) / (page?.pageSize ?? draft.pageSize)))

  const updateDraft = (changes: Partial<AuditReportFilterDraft>): void => {
    setDraft((current) => ({ ...current, ...changes }))
  }
  const selectPreset = (preset: Exclude<AuditReportRangePreset, 'CUSTOM'>): void => {
    updateDraft({
      rangePreset: preset,
      range: preset === 'ALL_TIME' ? draft.range : createAuditReportPresetRange(preset, timeZone)
    })
  }
  const submitFilters = (): void => {
    const next = applyAuditReportFilters(draft, timeZone)
    if (next === null) {
      setFilterMessage(
        draft.entityId.trim() !== '' && draft.entityType === ''
          ? 'Choose an entity type before entering an entity ID.'
          : 'Review the date range, entity ID, and search values.'
      )
      return
    }
    setFilterMessage(null)
    setApplied(next)
    setPreviewOpen(false)
    void loadPage(1, next)
  }
  const clearFilters = (): void => {
    const nextDraft = createInitialAuditReportFilters(timeZone)
    const nextApplied = applyAuditReportFilters(nextDraft, timeZone)
    setDraft(nextDraft)
    setFilterMessage(null)
    setApplied(nextApplied)
    setPreviewOpen(false)
    if (nextApplied !== null) void loadPage(1, nextApplied)
  }
  const openPreview = (): void => {
    setPreviewGeneratedAt(new Date().toISOString())
    setPreviewOpen(true)
  }

  return (
    <section className="audit-reports-workspace" aria-labelledby={headingId}>
      <header className="audit-reports-heading">
        <div>
          <p className="application-workspace-kicker">Administrator reporting</p>
          <h1 ref={headingRef} id={headingId} tabIndex={-1}>
            Audit Reports
          </h1>
        </div>
        <p>Read-only local activity for this deployment.</p>
      </header>

      <AuditReportFilters
        draft={draft}
        context={context}
        message={filterMessage}
        disabled={context === null || pageState.status === 'LOADING'}
        onUpdate={updateDraft}
        onPreset={selectPreset}
        onApply={submitFilters}
        onClear={clearFilters}
      />

      {contextState.status === 'ERROR' ? (
        <WorkspaceState message={contextState.message} />
      ) : (
        <div className="audit-reports-layout">
          <section className="audit-reports-list-panel" aria-label="Audit event results">
            <div className="audit-reports-list-summary" aria-live="polite">
              <strong>
                {pageState.status === 'LOADING'
                  ? 'Loading audit events...'
                  : `${page?.total ?? 0} audit events`}
              </strong>
              <span>{applied === null ? '' : auditRangeLabel(applied)}</span>
            </div>
            {pageState.status === 'ERROR' ? (
              <div className="audit-reports-inline-error" role="alert">
                <span>{pageState.message}</span>
                {applied === null ? null : (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void loadPage(page?.page ?? 1, applied)}
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : null}
            <div className="audit-reports-table-scroll">
              <table className="audit-reports-table">
                <thead>
                  <tr>
                    <th scope="col">Date / time</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.items.map((event) => (
                    <AuditEventRow
                      key={event.id}
                      event={event}
                      timeZone={timeZone}
                      selected={event.id === selectedId}
                      onSelect={() => setSelectedId(event.id)}
                    />
                  ))}
                  {pageState.status !== 'LOADING' && page?.items.length === 0 ? (
                    <tr>
                      <td className="audit-reports-empty" colSpan={4}>
                        No audit events match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <AuditPagination
              page={page}
              totalPages={totalPages}
              disabled={pageState.status === 'LOADING' || applied === null}
              onPage={(nextPage) => {
                if (applied !== null) void loadPage(nextPage, applied)
              }}
            />
          </section>

          <section className="audit-reports-detail-panel" aria-label="Selected audit event detail">
            {selected === null ? (
              <div className="audit-reports-empty-detail">
                {pageState.status === 'LOADING'
                  ? 'Loading event detail...'
                  : 'Select an audit event to review its complete details.'}
              </div>
            ) : (
              <AuditEventDetail event={selected} timeZone={timeZone} onPrintPreview={openPreview} />
            )}
          </section>
        </div>
      )}

      {previewOpen &&
      previewGeneratedAt !== null &&
      page !== null &&
      context !== null &&
      applied !== null ? (
        <AuditReportPrintPreview
          page={page}
          context={context}
          filters={applied}
          generatedAt={previewGeneratedAt}
          timeZone={timeZone}
          reportedBy={reportedBy}
          printButtonRef={printButtonRef}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </section>
  )
}

function AuditReportFilters({
  draft,
  context,
  message,
  disabled,
  onUpdate,
  onPreset,
  onApply,
  onClear
}: {
  readonly draft: AuditReportFilterDraft
  readonly context: AuditReportContext | null
  readonly message: string | null
  readonly disabled: boolean
  onUpdate(changes: Partial<AuditReportFilterDraft>): void
  onPreset(preset: Exclude<AuditReportRangePreset, 'CUSTOM'>): void
  onApply(): void
  onClear(): void
}): React.JSX.Element {
  return (
    <section className="audit-reports-filters" aria-label="Audit report filters">
      <div className="audit-reports-filter-presets" aria-label="Date range presets">
        <span>Date range</span>
        {rangePresets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            aria-pressed={draft.rangePreset === preset.value}
            onClick={() => onPreset(preset.value)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="audit-reports-filter-grid">
        <label>
          From
          <input
            type="date"
            value={draft.range.from}
            disabled={draft.rangePreset === 'ALL_TIME'}
            onChange={(event) =>
              onUpdate({
                rangePreset: 'CUSTOM',
                range: { ...draft.range, from: event.currentTarget.value }
              })
            }
          />
        </label>
        <label>
          Through
          <input
            type="date"
            value={draft.range.to}
            disabled={draft.rangePreset === 'ALL_TIME'}
            onChange={(event) =>
              onUpdate({
                rangePreset: 'CUSTOM',
                range: { ...draft.range, to: event.currentTarget.value }
              })
            }
          />
        </label>
        <label>
          Actor
          <select
            value={draft.actor}
            onChange={(event) => onUpdate({ actor: event.currentTarget.value })}
          >
            <option value="ALL">All actors</option>
            {context?.hasSystemEvents ? <option value="SYSTEM">System</option> : null}
            {context?.actors.map((actor) => (
              <option key={actor.id} value={auditActorValue(actor)}>
                {`${actor.displayName} (${actor.username})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select
            value={draft.action}
            onChange={(event) => onUpdate({ action: event.currentTarget.value })}
          >
            <option value="">All actions</option>
            {context?.actions.map((action) => (
              <option key={action} value={action}>
                {formatAuditCode(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity type
          <select
            value={draft.entityType}
            onChange={(event) =>
              onUpdate({
                entityType: event.currentTarget.value,
                entityId: event.currentTarget.value === '' ? '' : draft.entityId
              })
            }
          >
            <option value="">All entity types</option>
            {context?.entityTypes.map((entityType) => (
              <option key={entityType} value={entityType}>
                {formatAuditCode(entityType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Entity ID
          <input
            type="text"
            value={draft.entityId}
            placeholder="Exact UUID"
            disabled={draft.entityType === ''}
            onChange={(event) => onUpdate({ entityId: event.currentTarget.value })}
          />
        </label>
        <label className="audit-reports-query-filter">
          Search
          <input
            type="search"
            value={draft.query}
            maxLength={100}
            placeholder="Action, entity, actor, or username"
            onChange={(event) => onUpdate({ query: event.currentTarget.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onApply()
              }
            }}
          />
        </label>
        <label>
          Rows
          <select
            value={draft.pageSize}
            onChange={(event) =>
              onUpdate({ pageSize: Number(event.currentTarget.value) as 25 | 50 | 100 })
            }
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
        <div className="audit-reports-filter-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={disabled}
            onClick={onApply}
          >
            Apply filters
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={disabled}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
      {message === null ? null : <p role="alert">{message}</p>}
    </section>
  )
}

function AuditEventRow({
  event,
  timeZone,
  selected,
  onSelect
}: {
  readonly event: PublicAuditReportEvent
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
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault()
          onSelect()
        }
      }}
    >
      <td>{formatTimestamp(event.occurredAt, timeZone)}</td>
      <td>
        <strong>{event.actor?.displayName ?? 'System'}</strong>
        <span>{event.actor?.username ?? 'No user account'}</span>
      </td>
      <td>{formatAuditCode(event.action)}</td>
      <td>
        <strong>{formatAuditCode(event.entityType)}</strong>
        <span>{event.entityId ?? 'No entity ID'}</span>
      </td>
    </tr>
  )
}

function AuditEventDetail({
  event,
  timeZone,
  onPrintPreview
}: {
  readonly event: PublicAuditReportEvent
  readonly timeZone: string
  onPrintPreview(): void
}): React.JSX.Element {
  return (
    <article className="audit-report-event-detail">
      <header>
        <div>
          <p>Selected event</p>
          <h2>{formatAuditCode(event.action)}</h2>
          <span>{formatTimestamp(event.occurredAt, timeZone)}</span>
        </div>
        <span className="status-pill">Read only</span>
      </header>
      <dl className="audit-report-event-metadata">
        <DetailLine label="Event ID" value={event.id} />
        <DetailLine label="Actor" value={event.actor?.displayName ?? 'System'} />
        <DetailLine label="Username" value={event.actor?.username ?? 'Not applicable'} />
        <DetailLine
          label="Actor role"
          value={event.actor === null ? 'System' : formatAuditCode(event.actor.role)}
        />
        <DetailLine label="Entity type" value={formatAuditCode(event.entityType)} />
        <DetailLine label="Entity ID" value={event.entityId ?? 'Not recorded'} />
        <DetailLine label="Deployment" value={event.deployment.name} />
        <DetailLine label="Time zone" value={event.deployment.timeZone} />
      </dl>
      <section className="audit-report-metadata-section">
        <h3>Event metadata</h3>
        <pre>{formatMetadata(event.metadata)}</pre>
      </section>
      <div className="audit-report-browser-actions">
        <button className="button button-primary" type="button" onClick={onPrintPreview}>
          Print preview
        </button>
      </div>
    </article>
  )
}

function DetailLine({
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

function AuditPagination({
  page,
  totalPages,
  disabled,
  onPage
}: {
  readonly page: AuditReportPage | null
  readonly totalPages: number
  readonly disabled: boolean
  onPage(page: number): void
}): React.JSX.Element {
  const current = page?.page ?? 1
  const from = page === null || page.total === 0 ? 0 : (current - 1) * page.pageSize + 1
  const to = page === null ? 0 : Math.min(current * page.pageSize, page.total)
  return (
    <div className="audit-reports-pagination">
      <span>{`Showing ${from}-${to} of ${page?.total ?? 0}`}</span>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled || current <= 1}
        onClick={() => onPage(current - 1)}
      >
        Previous
      </button>
      <strong>{`Page ${current} of ${totalPages}`}</strong>
      <button
        className="button button-secondary"
        type="button"
        disabled={disabled || current >= totalPages}
        onClick={() => onPage(current + 1)}
      >
        Next
      </button>
    </div>
  )
}

function AuditReportPrintPreview({
  page,
  context,
  filters,
  generatedAt,
  timeZone,
  reportedBy,
  printButtonRef,
  onClose
}: {
  readonly page: AuditReportPage
  readonly context: AuditReportContext
  readonly filters: AppliedAuditReportFilters
  readonly generatedAt: string
  readonly timeZone: string
  readonly reportedBy: string
  readonly printButtonRef: RefObject<HTMLButtonElement | null>
  onClose(): void
}): React.JSX.Element {
  return (
    <div className="patient-report-preview-backdrop">
      <section
        className="patient-report-preview-window"
        role="dialog"
        aria-modal="true"
        aria-label="Audit report print preview"
      >
        <header className="patient-report-preview-toolbar">
          <div>
            <strong>Audit report print preview</strong>
            <span>{`Current filtered page - ${page.items.length} events`}</span>
          </div>
          <div>
            <button
              ref={printButtonRef}
              className="button button-primary"
              type="button"
              onClick={() => printReport(`CHS-audit-report-${generatedAt.slice(0, 10)}`)}
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
            <AuditReportDocument
              page={page}
              context={context}
              filters={filters}
              generatedAt={generatedAt}
              timeZone={timeZone}
              reportedBy={reportedBy}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function AuditReportDocument({
  page,
  context,
  filters,
  generatedAt,
  timeZone,
  reportedBy
}: {
  readonly page: AuditReportPage
  readonly context: AuditReportContext
  readonly filters: AppliedAuditReportFilters
  readonly generatedAt: string
  readonly timeZone: string
  readonly reportedBy: string
}): React.JSX.Element {
  const from = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1
  const to = Math.min(page.page * page.pageSize, page.total)
  return (
    <article className="audit-report-document is-print-preview">
      <header className="clinical-report-masthead patient-report-print-masthead">
        <span className="clinical-report-logo" aria-hidden="true" />
        <div>
          <strong>Community Health Screening</strong>
          <span>Audit report</span>
        </div>
        <span className="patient-report-print-disclaimer">
          Screening guidance is not a diagnosis
        </span>
      </header>
      <header className="audit-report-document-heading">
        <div>
          <p>Read-only administrator report</p>
          <h2>{context.deployment.name}</h2>
        </div>
        <dl>
          <DetailLine label="Generated" value={formatTimestamp(generatedAt, timeZone)} />
          <DetailLine label="Time zone" value={context.deployment.timeZone} />
          <DetailLine label="Reported by" value={reportedBy} />
        </dl>
      </header>
      <section className="audit-report-document-filters">
        <h3>Applied filters</h3>
        <p>{auditFilterSummary(filters, context.actors)}</p>
        <span>{`Showing ${from}-${to} of ${page.total} matching events; result page ${page.page}.`}</span>
      </section>
      <table className="audit-report-print-table">
        <thead>
          <tr>
            <th scope="col">Date / time</th>
            <th scope="col">Actor</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
            <th scope="col">Metadata</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((event) => (
            <tr key={event.id}>
              <td>{formatTimestamp(event.occurredAt, timeZone)}</td>
              <td>
                {event.actor === null
                  ? 'System'
                  : `${event.actor.displayName} (${event.actor.username})`}
              </td>
              <td>{formatAuditCode(event.action)}</td>
              <td>{`${formatAuditCode(event.entityType)}${event.entityId === null ? '' : ` / ${event.entityId}`}`}</td>
              <td>
                <pre>{formatMetadata(event.metadata)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="patient-report-page-footer" aria-label="Printed audit report page footer">
        <span>{context.deployment.name}</span>
        <span className="patient-report-page-number" aria-label="Printed page number">
          Page <span className="patient-report-current-page" /> of{' '}
          <span className="patient-report-total-pages" />
        </span>
        <span>{`Reported by ${reportedBy}`}</span>
      </footer>
    </article>
  )
}

function WorkspaceState({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <div className="audit-reports-state" role="alert">
      {message}
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

function formatTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(value))
}

function formatMetadata(metadata: PublicAuditReportEvent['metadata']): string {
  return Object.keys(metadata).length === 0
    ? 'No metadata recorded'
    : JSON.stringify(metadata, null, 2)
}

function printReport(fileName: string): void {
  const previousTitle = document.title
  document.title = fileName
  window.print()
  document.title = previousTitle
}
