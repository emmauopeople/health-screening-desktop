import type {
  AuditReportActorFilter,
  AuditReportSearchRequest,
  PublicAuditReportActor
} from '@shared/ipc'

export type AuditReportRangePreset =
  'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'ALL_TIME' | 'CUSTOM'

export interface AuditReportDateRange {
  readonly from: string
  readonly to: string
}

export interface AuditReportFilterDraft {
  readonly query: string
  readonly rangePreset: AuditReportRangePreset
  readonly range: AuditReportDateRange
  readonly actor: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  readonly pageSize: 25 | 50 | 100
}

export interface AppliedAuditReportFilters extends AuditReportFilterDraft {
  readonly request: Omit<AuditReportSearchRequest, 'page'>
}

export function createAuditReportPresetRange(
  preset: Exclude<AuditReportRangePreset, 'ALL_TIME' | 'CUSTOM'>,
  timeZone: string,
  now = new Date()
): AuditReportDateRange {
  const to = localDateFromTimestamp(now.toISOString(), timeZone)
  const daysBack = preset === 'TODAY' ? 0 : preset === 'LAST_7_DAYS' ? 6 : 29
  return Object.freeze({ from: shiftLocalDate(to, -daysBack), to })
}

export function createInitialAuditReportFilters(
  timeZone: string,
  now = new Date()
): AuditReportFilterDraft {
  return Object.freeze({
    query: '',
    rangePreset: 'LAST_30_DAYS',
    range: createAuditReportPresetRange('LAST_30_DAYS', timeZone, now),
    actor: 'ALL',
    action: '',
    entityType: '',
    entityId: '',
    pageSize: 25
  })
}

export function applyAuditReportFilters(
  draft: AuditReportFilterDraft,
  timeZone: string
): AppliedAuditReportFilters | null {
  const query = draft.query.trim()
  const entityId = draft.entityId.trim()
  if (query.length > 100 || !isValidAuditReportRange(draft.range, draft.rangePreset)) return null
  if (entityId !== '' && draft.entityType === '') return null

  let actor: AuditReportActorFilter
  if (draft.actor === 'SYSTEM') actor = { kind: 'SYSTEM' }
  else if (draft.actor.startsWith('USER:')) {
    const userId = draft.actor.slice('USER:'.length)
    if (!isUuid(userId)) return null
    actor = { kind: 'USER', userId }
  } else if (draft.actor === 'ALL') actor = { kind: 'ALL' }
  else return null

  if (entityId !== '' && !isUuid(entityId)) return null

  const bounds =
    draft.rangePreset === 'ALL_TIME'
      ? { occurredFromInclusive: null, occurredToExclusive: null }
      : toUtcHalfOpenBounds(draft.range, timeZone)
  if (bounds === null) return null

  const normalized = Object.freeze({
    ...draft,
    query,
    entityId,
    request: Object.freeze({
      query,
      occurredFromInclusive: bounds.occurredFromInclusive,
      occurredToExclusive: bounds.occurredToExclusive,
      actor,
      action: draft.action === '' ? null : draft.action,
      entityType: draft.entityType === '' ? null : draft.entityType,
      entityId: entityId === '' ? null : entityId,
      pageSize: draft.pageSize
    })
  })
  return normalized
}

export function isValidAuditReportRange(
  range: AuditReportDateRange,
  preset: AuditReportRangePreset
): boolean {
  return (
    preset === 'ALL_TIME' ||
    (isLocalDate(range.from) && isLocalDate(range.to) && range.from <= range.to)
  )
}

export function auditActorValue(actor: PublicAuditReportActor): string {
  return `USER:${actor.id}`
}

export function auditRangeLabel(filters: AppliedAuditReportFilters): string {
  if (filters.rangePreset === 'ALL_TIME') return 'All recorded dates'
  return `${formatLocalDate(filters.range.from)} to ${formatLocalDate(filters.range.to)}`
}

export function auditFilterSummary(
  filters: AppliedAuditReportFilters,
  actors: readonly PublicAuditReportActor[]
): string {
  const parts = [auditRangeLabel(filters)]
  if (filters.actor === 'SYSTEM') parts.push('Actor: System')
  else if (filters.actor.startsWith('USER:')) {
    const actor = actors.find((item) => auditActorValue(item) === filters.actor)
    parts.push(`Actor: ${actor?.displayName ?? 'Selected user'}`)
  } else parts.push('Actor: All')
  if (filters.action !== '') parts.push(`Action: ${formatAuditCode(filters.action)}`)
  if (filters.entityType !== '') parts.push(`Entity: ${formatAuditCode(filters.entityType)}`)
  if (filters.entityId !== '') parts.push(`ID: ${filters.entityId}`)
  if (filters.query !== '') parts.push(`Search: ${filters.query}`)
  return parts.join(' | ')
}

export function formatAuditCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (letter) => letter.toUpperCase())
}

export function formatLocalDate(value: string): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  )
}

export function localDateFromTimestamp(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values['year']}-${values['month']}-${values['day']}`
}

function toUtcHalfOpenBounds(
  range: AuditReportDateRange,
  timeZone: string
): Pick<AuditReportSearchRequest, 'occurredFromInclusive' | 'occurredToExclusive'> | null {
  try {
    return Object.freeze({
      occurredFromInclusive: localMidnightToUtc(range.from, timeZone),
      occurredToExclusive: localMidnightToUtc(shiftLocalDate(range.to, 1), timeZone)
    })
  } catch {
    return null
  }
}

function localMidnightToUtc(localDate: string, timeZone: string): string {
  const [year = 0, month = 0, day = 0] = localDate.split('-').map(Number)
  const target = Date.UTC(year, month - 1, day)
  let candidate = target
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone
  })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value])
    )
    const represented = Date.UTC(
      Number(parts['year']),
      Number(parts['month']) - 1,
      Number(parts['day']),
      Number(parts['hour']),
      Number(parts['minute']),
      Number(parts['second'])
    )
    const adjustment = target - represented
    candidate += adjustment
    if (adjustment === 0) break
  }

  return new Date(candidate).toISOString()
}

function shiftLocalDate(value: string, days: number): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`
}

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}
