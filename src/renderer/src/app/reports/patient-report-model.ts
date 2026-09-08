import type {
  HealthScreeningApi,
  PublicManagedEncounterDetail,
  PublicPatientDetail,
  PublicPatientHistoryEncounter,
  PublicPatientSummary,
  PublicReferralDetail
} from '@shared/ipc'

export type PatientReportKind = 'GENERAL' | 'VITALS' | 'LIFESTYLE' | 'REFERRALS'
export type PatientReportRangePreset = 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CUSTOM'

export interface PatientReportDateRange {
  readonly from: string
  readonly to: string
}

export interface PatientReportData {
  readonly patient: PublicPatientDetail
  readonly kind: PatientReportKind
  readonly range: PatientReportDateRange
  readonly generatedAt: string
  readonly encounters: readonly PublicPatientHistoryEncounter[]
  readonly encounterDetails: readonly PublicManagedEncounterDetail[]
  readonly referrals: readonly PublicReferralDetail[]
}

export type PatientReportAuthenticationCode =
  | 'IPC_FORBIDDEN'
  | 'AUTH_UNAUTHENTICATED'
  | 'AUTH_LOCKED'
  | 'AUTH_PASSWORD_CHANGE_REQUIRED'
  | 'AUTHORIZATION_FAILED'

export type PatientReportLoadResult =
  | { readonly status: 'LOADED'; readonly report: PatientReportData }
  | { readonly status: 'AUTHENTICATION_FAILED'; readonly code: PatientReportAuthenticationCode }
  | { readonly status: 'FAILED'; readonly message: string }

const pageSize = 100

export async function loadPatientReport(
  api: HealthScreeningApi,
  patientSummary: PublicPatientSummary,
  kind: PatientReportKind,
  range: PatientReportDateRange,
  timeZone: string
): Promise<PatientReportLoadResult> {
  try {
    const patientResult = await api.patient.get({ patientId: patientSummary.id })
    if (!patientResult.ok) return failureFromCode(patientResult.error.code)

    const encountersResult =
      kind === 'REFERRALS'
        ? ({ status: 'LOADED', encounters: [] } as const)
        : await loadEncounters(api, patientSummary.id, range, timeZone)
    if (encountersResult.status !== 'LOADED') return encountersResult

    const detailsResult = await loadEncounterDetails(api, encountersResult.encounters)
    if (detailsResult.status !== 'LOADED') return detailsResult

    const referralsResult =
      kind === 'GENERAL' || kind === 'REFERRALS'
        ? await loadReferrals(api, patientSummary, range, timeZone)
        : ({ status: 'LOADED', referrals: [] } as const)
    if (referralsResult.status !== 'LOADED') return referralsResult

    return {
      status: 'LOADED',
      report: {
        patient: patientResult.data,
        kind,
        range,
        generatedAt: new Date().toISOString(),
        encounters: encountersResult.encounters,
        encounterDetails: detailsResult.details,
        referrals: referralsResult.referrals
      }
    }
  } catch {
    return { status: 'FAILED', message: 'The patient report could not be loaded.' }
  }
}

export function createPresetDateRange(
  preset: Exclude<PatientReportRangePreset, 'CUSTOM'>,
  timeZone: string,
  now = new Date()
): PatientReportDateRange {
  const to = localDateFromTimestamp(now.toISOString(), timeZone)
  return {
    from: shiftLocalDate(to, preset === 'LAST_7_DAYS' ? -6 : -29),
    to
  }
}

export function isValidDateRange(range: PatientReportDateRange): boolean {
  return isLocalDate(range.from) && isLocalDate(range.to) && range.from <= range.to
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

async function loadEncounters(
  api: HealthScreeningApi,
  patientId: string,
  range: PatientReportDateRange,
  timeZone: string
): Promise<
  | { readonly status: 'LOADED'; readonly encounters: readonly PublicPatientHistoryEncounter[] }
  | Exclude<PatientReportLoadResult, { readonly status: 'LOADED' }>
> {
  const encounters: PublicPatientHistoryEncounter[] = []
  let page = 1
  while (true) {
    const result = await api.screeningEncounters.management.getPatientHistory({
      patientId,
      page,
      pageSize
    })
    if (!result.ok) return failureFromCode(result.error.code)
    if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)

    for (const encounter of result.data.history.items) {
      const date = localDateFromTimestamp(encounter.completedAt, timeZone)
      if (date >= range.from && date <= range.to) encounters.push(encounter)
    }

    const loaded = page * pageSize
    const lastEncounter = result.data.history.items.at(-1)
    const reachedStart =
      lastEncounter !== undefined &&
      localDateFromTimestamp(lastEncounter.completedAt, timeZone) < range.from
    if (
      loaded >= result.data.history.total ||
      result.data.history.items.length === 0 ||
      reachedStart
    ) {
      break
    }
    page += 1
  }
  return { status: 'LOADED', encounters }
}

async function loadEncounterDetails(
  api: HealthScreeningApi,
  encounters: readonly PublicPatientHistoryEncounter[]
): Promise<
  | { readonly status: 'LOADED'; readonly details: readonly PublicManagedEncounterDetail[] }
  | Exclude<PatientReportLoadResult, { readonly status: 'LOADED' }>
> {
  const results = await mapWithConcurrency(encounters, 6, async (encounter) =>
    api.screeningEncounters.management.getDetail({ encounterId: encounter.id })
  )
  const details: PublicManagedEncounterDetail[] = []
  for (const result of results) {
    if (!result.ok) return failureFromCode(result.error.code)
    if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)
    details.push(result.data.detail)
  }
  return { status: 'LOADED', details }
}

async function loadReferrals(
  api: HealthScreeningApi,
  patient: PublicPatientSummary,
  range: PatientReportDateRange,
  timeZone: string
): Promise<
  | { readonly status: 'LOADED'; readonly referrals: readonly PublicReferralDetail[] }
  | Exclude<PatientReportLoadResult, { readonly status: 'LOADED' }>
> {
  const referralIds: string[] = []
  let page = 1
  while (true) {
    const result = await api.referrals.search({
      query: patient.patientCode,
      statuses: ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED'],
      urgency: null,
      dueFrom: null,
      dueTo: null,
      page,
      pageSize
    })
    if (!result.ok) return failureFromCode(result.error.code)
    if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)
    referralIds.push(
      ...result.data.items.filter((item) => item.patientId === patient.id).map((item) => item.id)
    )
    if (page * pageSize >= result.data.total || result.data.items.length === 0) break
    page += 1
  }

  const results = await mapWithConcurrency(referralIds, 6, async (referralId) =>
    api.referrals.getDetail({ referralId })
  )
  const referrals: PublicReferralDetail[] = []
  for (const result of results) {
    if (!result.ok) return failureFromCode(result.error.code)
    if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)
    if (referralTouchesRange(result.data.detail, range, timeZone)) {
      referrals.push(result.data.detail)
    }
  }
  referrals.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return { status: 'LOADED', referrals }
}

function referralTouchesRange(
  referral: PublicReferralDetail,
  range: PatientReportDateRange,
  timeZone: string
): boolean {
  if (referral.status !== 'CLOSED') return true
  if (dateInRange(localDateFromTimestamp(referral.createdAt, timeZone), range)) return true
  if (
    referral.statusHistory.some((item) =>
      dateInRange(localDateFromTimestamp(item.changedAt, timeZone), range)
    )
  ) {
    return true
  }
  return referral.followups.some((item) => dateInRange(item.contactDate, range))
}

function dateInRange(value: string, range: PatientReportDateRange): boolean {
  return value >= range.from && value <= range.to
}

function failureFromCode(code: string): Exclude<PatientReportLoadResult, { status: 'LOADED' }> {
  if (isAuthenticationCode(code)) return { status: 'AUTHENTICATION_FAILED', code }
  return { status: 'FAILED', message: 'The patient report could not be loaded.' }
}

function failureFromControlledStatus(
  status: string
): Exclude<PatientReportLoadResult, { status: 'LOADED' }> {
  if (status === 'AUTHENTICATION_REQUIRED') {
    return { status: 'AUTHENTICATION_FAILED', code: 'AUTH_UNAUTHENTICATED' }
  }
  if (status === 'FORBIDDEN') {
    return { status: 'AUTHENTICATION_FAILED', code: 'AUTHORIZATION_FAILED' }
  }
  if (isAuthenticationCode(status)) return { status: 'AUTHENTICATION_FAILED', code: status }
  return {
    status: 'FAILED',
    message:
      status === 'PATIENT_NOT_FOUND'
        ? 'The patient report was not found.'
        : 'The patient report could not be loaded.'
  }
}

function isAuthenticationCode(value: string): value is PatientReportAuthenticationCode {
  return (
    value === 'IPC_FORBIDDEN' ||
    value === 'AUTH_UNAUTHENTICATED' ||
    value === 'AUTH_LOCKED' ||
    value === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    value === 'AUTHORIZATION_FAILED'
  )
}

function shiftLocalDate(value: string, days: number): string {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput) => Promise<TOutput>
): Promise<readonly TOutput[]> {
  const results = new Array<TOutput>(items.length)
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index]!)
      }
    })
  )
  return results
}
