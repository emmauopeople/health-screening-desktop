import type {
  HealthScreeningApi,
  PublicPatientDetail,
  PublicPatientSummary,
  PublicReferralDetail
} from '@shared/ipc'
import { localDateFromTimestamp, type PatientReportData } from './patient-report-model'

export interface ReferralPatientReportData {
  readonly patient: PublicPatientDetail
  readonly referrals: readonly PublicReferralDetail[]
}

export type ReferralPatientReportAuthenticationCode =
  | 'IPC_FORBIDDEN'
  | 'AUTH_UNAUTHENTICATED'
  | 'AUTH_LOCKED'
  | 'AUTH_PASSWORD_CHANGE_REQUIRED'
  | 'AUTHORIZATION_FAILED'

export type ReferralPatientReportLoadResult =
  | { readonly status: 'LOADED'; readonly data: ReferralPatientReportData }
  | {
      readonly status: 'AUTHENTICATION_FAILED'
      readonly code: ReferralPatientReportAuthenticationCode
    }
  | { readonly status: 'FAILED'; readonly message: string }

const pageSize = 100
const allStatuses = ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED'] as const

export async function loadReferralPatientReport(
  api: HealthScreeningApi,
  patient: PublicPatientSummary
): Promise<ReferralPatientReportLoadResult> {
  try {
    const patientResult = await api.patient.get({ patientId: patient.id })
    if (!patientResult.ok) return failureFromCode(patientResult.error.code)

    const referralIds: string[] = []
    let page = 1
    while (true) {
      const result = await api.referrals.search({
        query: '',
        patientId: patient.id,
        statuses: [...allStatuses],
        urgency: null,
        dueFrom: null,
        dueTo: null,
        page,
        pageSize
      })
      if (!result.ok) return failureFromCode(result.error.code)
      if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)
      referralIds.push(...result.data.items.map((item) => item.id))
      if (page * pageSize >= result.data.total || result.data.items.length === 0) break
      page += 1
    }

    const detailResults = await mapWithConcurrency(referralIds, 6, (referralId) =>
      api.referrals.getDetail({ referralId })
    )
    const referrals: PublicReferralDetail[] = []
    for (const result of detailResults) {
      if (!result.ok) return failureFromCode(result.error.code)
      if (result.data.status !== 'LOADED') return failureFromControlledStatus(result.data.status)
      if (result.data.detail.patientId !== patient.id) {
        return {
          status: 'FAILED',
          message: 'The referral report returned unexpected patient data.'
        }
      }
      referrals.push(result.data.detail)
    }
    referrals.sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    return {
      status: 'LOADED',
      data: { patient: patientResult.data, referrals }
    }
  } catch {
    return { status: 'FAILED', message: 'The referral report could not be loaded.' }
  }
}

export function createPrintableReferralReport(
  data: ReferralPatientReportData,
  referrals: readonly PublicReferralDetail[],
  timeZone: string,
  generatedAt = new Date().toISOString()
): PatientReportData {
  const firstReferral = referrals.at(-1)
  return {
    patient: data.patient,
    kind: 'REFERRALS',
    range: {
      from: localDateFromTimestamp(firstReferral?.createdAt ?? data.patient.createdAt, timeZone),
      to: localDateFromTimestamp(generatedAt, timeZone)
    },
    generatedAt,
    encounters: [],
    encounterDetails: [],
    referrals
  }
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  task: (item: Input) => Promise<Output>
): Promise<Output[]> {
  const output = new Array<Output>(items.length)
  let index = 0
  async function worker(): Promise<void> {
    while (index < items.length) {
      const current = index
      index += 1
      output[current] = await task(items[current]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return output
}

function failureFromCode(
  code: string
): Exclude<ReferralPatientReportLoadResult, { status: 'LOADED' }> {
  if (isAuthenticationCode(code)) return { status: 'AUTHENTICATION_FAILED', code }
  return { status: 'FAILED', message: 'The referral report could not be loaded.' }
}

function failureFromControlledStatus(
  status: string
): Exclude<ReferralPatientReportLoadResult, { status: 'LOADED' }> {
  if (status === 'AUTHENTICATION_REQUIRED') {
    return { status: 'AUTHENTICATION_FAILED', code: 'AUTH_UNAUTHENTICATED' }
  }
  if (status === 'FORBIDDEN') {
    return { status: 'AUTHENTICATION_FAILED', code: 'AUTHORIZATION_FAILED' }
  }
  if (isAuthenticationCode(status)) return { status: 'AUTHENTICATION_FAILED', code: status }
  return { status: 'FAILED', message: 'The referral report could not be loaded.' }
}

function isAuthenticationCode(code: string): code is ReferralPatientReportAuthenticationCode {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}
