// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicPatientDetail,
  type PublicPatientSummary,
  type PublicReferralDetail,
  type PublicReferralSummary
} from '@shared/ipc'
import { ReferralReportsWorkspace } from '../../../src/renderer/src/app/reports/ReferralReportsWorkspace'

const patientId = '11111111-1111-4111-8111-111111111111'
const firstReferralId = '22222222-2222-4222-8222-222222222222'
const secondReferralId = '33333333-3333-4333-8333-333333333333'
const firstEncounterId = '44444444-4444-4444-8444-444444444444'
const secondEncounterId = '55555555-5555-4555-8555-555555555555'

const patient: PublicPatientSummary = {
  id: patientId,
  patientCode: 'PT-000003',
  displayName: 'Suzana Fuavesan',
  givenName: 'Suzana',
  familyName: 'Fuavesan',
  otherNames: null,
  dateOfBirth: '1998-01-15',
  approximateAgeYears: null,
  ageAsOfDate: null,
  sex: 'FEMALE',
  village: 'Babungo',
  quarter: 'Mbukang',
  phone: '+237 600 000 003',
  status: 'ACTIVE',
  rowVersion: 1,
  updatedAt: '2026-09-03T08:00:00.000Z'
}

const patientDetail: PublicPatientDetail = {
  ...patient,
  alternateContactName: 'Peter Mbato-anar',
  alternateContactPhone: '+237 600 000 004',
  residenceNotes: null,
  acknowledgment: {
    status: 'NOT_REQUESTED',
    recordedAt: null,
    recordedByDisplayName: null
  },
  createdAt: '2026-08-01T08:00:00.000Z',
  createdByDisplayName: 'Nurse E.',
  updatedByDisplayName: 'Nurse E.',
  clinicalStatus: 'NOT_AVAILABLE'
}

const firstReferral = createReferral({
  id: firstReferralId,
  encounterId: firstEncounterId,
  createdAt: '2026-09-03T10:05:00.000Z',
  reasonText: 'Blood pressure screening referral',
  systolic: 130,
  diastolic: 91,
  status: 'CONTACTED',
  treatment: true
})
const secondReferral = createReferral({
  id: secondReferralId,
  encounterId: secondEncounterId,
  createdAt: '2026-08-20T10:05:00.000Z',
  reasonText: 'Urgent blood pressure screening referral',
  systolic: 178,
  diastolic: 112,
  status: 'OPEN',
  treatment: false
})

describe('ReferralReportsWorkspace', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects a patient, shows all referrals at left, and opens exact detail at right', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    const patientCombobox =
      mounted.container.querySelector<HTMLInputElement>('input[role="combobox"]')
    expect(patientCombobox).not.toBeNull()
    await focusInput(patientCombobox!)
    expect(mounted.container.querySelector('[role="listbox"]')?.textContent).toContain(
      'Suzana FuavesanPT-000003 - DOB Jan 15, 1998'
    )

    await changeInput(patientCombobox!, 'Su')
    await waitForSearch()
    expect(harness.searchPatients).toHaveBeenCalledTimes(1)
    expect(mounted.container.textContent).toContain('Filtering begins after 3 characters.')

    await changeInput(patientCombobox!, 'Suz')
    await waitForSearch()
    expect(harness.searchPatients).toHaveBeenLastCalledWith({
      query: 'Suz',
      page: 1,
      pageSize: 100
    })
    await clickPatientOption(mounted.container, 'Suzana Fuavesan')
    expect(patientCombobox?.value).toBe('Suzana Fuavesan - PT-000003')
    expect(patientCombobox?.getAttribute('aria-expanded')).toBe('false')

    expect(harness.searchReferrals).toHaveBeenCalledWith({
      query: '',
      patientId,
      statuses: ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM', 'CLOSED'],
      urgency: null,
      dueFrom: null,
      dueTo: null,
      page: 1,
      pageSize: 100
    })
    expect(mounted.container.textContent).toContain('Suzana Fuavesan')
    expect(mounted.container.textContent).toContain('Jan 15, 1998')
    expect(mounted.container.textContent).toContain('2 referrals')

    const table = mounted.container.querySelector('.referral-reports-table')
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(Array.from(table?.querySelectorAll('th') ?? []).map((item) => item.textContent)).toEqual(
      ['Date', 'Reason', 'Status', 'Treatment', 'Medication']
    )
    expect(table?.textContent).toContain('Blood pressure screening referral - BP 130/91 mmHg')
    expect(table?.textContent).toContain(
      'Urgent blood pressure screening referral - BP 178/112 mmHg'
    )
    expect(mounted.container.textContent).toContain('Patient reached by phone')

    await clickRow(table!, 'Urgent blood pressure screening referral')
    const detail = mounted.container.querySelector('.referral-reports-detail-scroll')
    expect(detail?.textContent).toContain('Urgent blood pressure screening referral')
    expect(detail?.textContent).not.toContain('Patient reached by phone')

    await clickButton(detail!, 'Open referral')
    await clickButton(detail!, 'Open encounter')
    expect(harness.onOpenReferral).toHaveBeenCalledWith(secondReferralId)
    expect(harness.onOpenEncounter).toHaveBeenCalledWith(secondEncounterId)

    await mounted.unmount()
  })

  it('previews either one selected referral or every referral for the patient', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const harness = createHarness()
    const mounted = await mount(harness)
    const patientCombobox =
      mounted.container.querySelector<HTMLInputElement>('input[role="combobox"]')
    await focusInput(patientCombobox!)
    await clickPatientOption(mounted.container, 'Suzana Fuavesan')

    await clickButton(mounted.container, 'Print preview')
    let dialog = mounted.container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Selected referral for Suzana Fuavesan')
    expect(dialog?.querySelectorAll('.patient-report-referral-record')).toHaveLength(1)
    expect(dialog?.textContent).toContain('Community Health Screening')
    expect(dialog?.textContent).toContain('Reported by Nurse E.')
    await clickButton(dialog!, 'Close')

    await checkRadio(mounted.container, 'ALL')
    await clickButton(mounted.container, 'Print preview')
    dialog = mounted.container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('All 2 referrals for Suzana Fuavesan')
    expect(dialog?.querySelectorAll('.patient-report-referral-record')).toHaveLength(2)
    await clickButton(dialog!, 'Print')
    expect(printSpy).toHaveBeenCalledOnce()

    await mounted.unmount()
  })
})

interface Harness {
  readonly api: HealthScreeningApi
  readonly searchPatients: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  readonly searchReferrals: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['search']>>
  readonly onOpenEncounter: ReturnType<typeof vi.fn<(encounterId: string) => void>>
  readonly onOpenReferral: ReturnType<typeof vi.fn<(referralId: string) => void>>
}

function createHarness(): Harness {
  const searchPatients = vi.fn<HealthScreeningApi['patient']['search']>(() =>
    Promise.resolve(
      createIpcSuccess({ items: [patient], total: 1, page: 1, pageSize: 100, query: '' })
    )
  )
  const getPatient = vi.fn<HealthScreeningApi['patient']['get']>(() =>
    Promise.resolve(createIpcSuccess(patientDetail))
  )
  const searchReferrals = vi.fn<HealthScreeningApi['referrals']['search']>(() =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        items: [summary(firstReferral), summary(secondReferral)],
        total: 2,
        page: 1,
        pageSize: 100
      })
    )
  )
  const getDetail = vi.fn<HealthScreeningApi['referrals']['getDetail']>(({ referralId }) =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        detail: referralId === firstReferralId ? firstReferral : secondReferral
      })
    )
  )
  return {
    searchPatients,
    searchReferrals,
    onOpenEncounter: vi.fn<(encounterId: string) => void>(),
    onOpenReferral: vi.fn<(referralId: string) => void>(),
    api: {
      patient: { search: searchPatients, get: getPatient },
      referrals: { search: searchReferrals, getDetail }
    } as unknown as HealthScreeningApi
  }
}

function createReferral(input: {
  readonly id: string
  readonly encounterId: string
  readonly createdAt: string
  readonly reasonText: string
  readonly systolic: number
  readonly diastolic: number
  readonly status: PublicReferralDetail['status']
  readonly treatment: boolean
}): PublicReferralDetail {
  return {
    id: input.id,
    patientId,
    encounterId: input.encounterId,
    patientCode: patient.patientCode,
    patientDisplayName: patient.displayName,
    urgency: input.systolic >= 180 || input.diastolic >= 110 ? 'URGENT' : 'STANDARD',
    dueDate: '2026-09-10',
    status: input.status,
    lastContactDate: input.treatment ? '2026-09-04' : null,
    recordVersion: input.treatment ? 2 : 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    reasonCodes: ['BP_SCREENING_REFERRAL'],
    reasonText: input.reasonText,
    triggeringBloodPressure: { systolic: input.systolic, diastolic: input.diastolic },
    destinationName: input.treatment ? 'Babungo Health Centre' : null,
    closureReason: null,
    closedAt: null,
    statusHistory: [
      {
        id: `${input.id.slice(0, -1)}9`,
        fromStatus: null,
        toStatus: 'OPEN',
        changeReason: null,
        changedByDisplayName: 'Nurse E.',
        changedAt: input.createdAt
      },
      ...(input.treatment
        ? [
            {
              id: `${input.id.slice(0, -1)}8`,
              fromStatus: 'OPEN' as const,
              toStatus: 'CONTACTED' as const,
              changeReason: 'Patient reached by phone',
              changedByDisplayName: 'Nurse E.',
              changedAt: '2026-09-04T09:00:00.000Z'
            }
          ]
        : [])
    ],
    followups: input.treatment
      ? [
          {
            id: '66666666-6666-4666-8666-666666666666',
            contactDate: '2026-09-04',
            contactMethod: 'PHONE',
            informationSource: 'PATIENT',
            providerSeen: true,
            facilityName: 'Babungo Health Centre',
            dateSeen: '2026-09-04',
            reportedOutcome: 'Provider reviewed blood pressure management.',
            reportedMedicationsOrAdvice: 'Continue medication and reduce salt.',
            nextAction: 'Repeat blood pressure in one week.',
            nextFollowupDate: '2026-09-11',
            sourceType: 'PATIENT_REPORTED',
            treatmentActions: ['TREATMENT_MODIFIED', 'NEW_MEDICATION'],
            medicationChanges: [
              {
                id: '77777777-7777-4777-8777-777777777777',
                changeType: 'NEW_MEDICATION',
                medicationName: 'Amlodipine',
                dosage: '5 mg',
                frequency: 'Daily'
              }
            ],
            recordedByDisplayName: 'Nurse E.',
            recordedAt: '2026-09-04T09:00:00.000Z'
          }
        ]
      : []
  }
}

function summary(referral: PublicReferralDetail): PublicReferralSummary {
  return {
    id: referral.id,
    patientId: referral.patientId,
    encounterId: referral.encounterId,
    patientCode: referral.patientCode,
    patientDisplayName: referral.patientDisplayName,
    urgency: referral.urgency,
    dueDate: referral.dueDate,
    status: referral.status,
    lastContactDate: referral.lastContactDate,
    recordVersion: referral.recordVersion,
    createdAt: referral.createdAt,
    updatedAt: referral.updatedAt
  }
}

async function mount(harness: Harness): Promise<{
  readonly container: HTMLElement
  unmount(): Promise<void>
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(ReferralReportsWorkspace, {
        api: harness.api,
        timeZone: 'Africa/Douala',
        reportedBy: 'Nurse E.',
        headingId: 'referral-reports-heading',
        headingRef: { current: null },
        onAuthenticationFailure: vi.fn(),
        onOpenEncounter: harness.onOpenEncounter,
        onOpenReferral: harness.onOpenReferral
      })
    )
    await flush()
  })
  await act(flush)
  return {
    container,
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flush()
      })
    }
  }
}

async function focusInput(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.focus()
    await flush()
  })
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  })
}

async function clickPatientOption(container: Element, text: string): Promise<void> {
  const option = Array.from(container.querySelectorAll('[role="option"]')).find((item) =>
    item.textContent?.includes(text)
  )
  if (!(option instanceof HTMLButtonElement)) throw new Error(`Missing patient option: ${text}`)
  await act(async () => {
    option.click()
    await flush()
  })
  await act(flush)
}

async function waitForSearch(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300))
  })
}

async function clickRow(container: Element, text: string): Promise<void> {
  const row = Array.from(container.querySelectorAll('tbody tr')).find((item) =>
    item.textContent?.includes(text)
  )
  if (!(row instanceof HTMLElement)) throw new Error(`Missing row: ${text}`)
  await act(async () => {
    row.click()
    await flush()
  })
}

async function checkRadio(container: Element, value: string): Promise<void> {
  const radio = container.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)
  if (radio === null) throw new Error(`Missing radio: ${value}`)
  await act(async () => {
    radio.click()
    await flush()
  })
}

async function clickButton(container: Element, text: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`)
  await act(async () => {
    button.click()
    await flush()
  })
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
