// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicManagedEncounterDetail,
  type PublicPatientDetail,
  type PublicPatientScreeningHistory,
  type PublicPatientSummary,
  type PublicReferralDetail,
  type PublicReferralSummary
} from '@shared/ipc'
import { PatientReportsWorkspace } from '../../../src/renderer/src/app/reports/PatientReportsWorkspace'

const patientId = '11111111-1111-4111-8111-111111111111'
const encounterId = '22222222-2222-4222-8222-222222222222'
const secondEncounterId = '55555555-5555-4555-8555-555555555555'
const referralId = '33333333-3333-4333-8333-333333333333'
const screeningSessionId = '66666666-6666-4666-8666-666666666666'

const patientSummary: PublicPatientSummary = {
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
  ...patientSummary,
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

const history: PublicPatientScreeningHistory = {
  patientId,
  items: [
    {
      id: encounterId,
      completedAt: '2026-09-03T10:00:00.000Z',
      systolic: 130,
      diastolic: 63,
      pulse: 77,
      nextAction: 'ROUTINE',
      weightKg: 68.5,
      referral: {
        id: referralId,
        status: 'CONTACTED',
        urgency: 'STANDARD',
        dueDate: '2026-09-10',
        closedAt: null,
        latestFollowup: null
      }
    },
    {
      id: secondEncounterId,
      completedAt: '2026-08-26T10:00:00.000Z',
      systolic: 103,
      diastolic: 91,
      pulse: 77,
      nextAction: 'REFER',
      weightKg: null,
      referral: null
    }
  ],
  total: 2,
  page: 1,
  pageSize: 100,
  trendEncounters: [],
  thirtyDayAverage: { systolic: 117, diastolic: 77, encounterCount: 2 }
}

const encounterDetails: readonly PublicManagedEncounterDetail[] = [
  createEncounterDetail(encounterId, '2026-09-03T10:00:00.000Z', {
    systolic: 130,
    diastolic: 63,
    pulse: 77,
    lifestyle: [
      { questionCode: 'WEEKLY_ALCOHOL', responseCode: 'NO' },
      { questionCode: 'WEEKLY_TOBACCO', responseCode: 'NO' },
      { questionCode: 'WEEKLY_PHYSICAL_ACTIVITY', responseCode: 'YES' },
      { questionCode: 'WEEKLY_WORK', responseCode: 'YES' },
      { questionCode: 'WEEKLY_OTHER_ACTIVITY', responseCode: 'NO' }
    ],
    foods: [
      { foodName: 'Leafy greens', frequencyCode: 'EVERY_DAY', notes: 'Prepared without salt' }
    ],
    otcMedications: [
      {
        productName: 'Paracetamol',
        reasonForUse: 'Headache',
        doseText: '500 mg',
        frequencyText: 'As needed',
        durationText: '3 days',
        sourceOfMedication: 'Community pharmacy',
        currentlyTaking: true
      }
    ]
  }),
  createEncounterDetail(secondEncounterId, '2026-08-26T10:00:00.000Z', {
    systolic: 103,
    diastolic: 91,
    pulse: 77,
    lifestyle: [{ questionCode: 'WEEKLY_ALCOHOL', responseCode: 'YES' }],
    foods: [],
    otcMedications: []
  })
]

const referralSummary: PublicReferralSummary = {
  id: referralId,
  patientId,
  encounterId,
  patientCode: patientSummary.patientCode,
  patientDisplayName: patientSummary.displayName,
  urgency: 'STANDARD',
  dueDate: '2026-09-10',
  status: 'CONTACTED',
  lastContactDate: '2026-09-04',
  recordVersion: 2,
  createdAt: '2026-09-03T10:05:00.000Z',
  updatedAt: '2026-09-04T09:00:00.000Z'
}

const referralDetail: PublicReferralDetail = {
  ...referralSummary,
  reasonCodes: ['BP_SCREENING_REFERRAL'],
  reasonText: 'Blood pressure screening referral',
  triggeringBloodPressure: { systolic: 130, diastolic: 91 },
  destinationName: 'Babungo Health Centre',
  closureReason: null,
  closedAt: null,
  statusHistory: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      fromStatus: null,
      toStatus: 'OPEN',
      changeReason: null,
      changedByDisplayName: 'Nurse E.',
      changedAt: '2026-09-03T10:05:00.000Z'
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      fromStatus: 'OPEN',
      toStatus: 'CONTACTED',
      changeReason: 'Patient reached by phone',
      changedByDisplayName: 'Nurse E.',
      changedAt: '2026-09-04T09:00:00.000Z'
    }
  ],
  followups: [
    {
      id: '44444444-4444-4444-8444-444444444444',
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
          id: '99999999-9999-4999-8999-999999999999',
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
}

describe('PatientReportsWorkspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('creates a complete general browser report and opens a dedicated printable preview', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    expect(harness.searchPatients).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(
      mounted.container
        .querySelector('#patient-report-search')
        ?.closest('.patient-reports-list-panel')
    ).not.toBeNull()

    await clickRow(mounted.container, 'Suzana Fuavesan')

    expect(harness.getPatientHistory).toHaveBeenCalledWith({
      patientId,
      page: 1,
      pageSize: 100
    })
    expect(harness.searchReferrals).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'PT-000003', pageSize: 100 })
    )
    expect(harness.getEncounterDetail).toHaveBeenCalledTimes(2)
    expect(harness.getReferralDetail).toHaveBeenCalledWith({ referralId })

    const browserReport = reportDocument(mounted.container)
    expect(browserReport.textContent).toContain('General patient report')
    expect(browserReport.textContent).toContain('Peter Mbato-anar')
    expect(browserReport.textContent).toContain('Vitals')
    expect(browserReport.textContent).toContain('Physical activity')
    expect(browserReport.textContent).toContain('Leafy greens')
    expect(browserReport.textContent).toContain('Paracetamol')
    expect(browserReport.textContent).toContain('500 mg / As needed')
    expect(browserReport.textContent).toContain('Amlodipine')
    expect(browserReport.textContent).toContain('Treatment modified, New medication')
    expect(browserReport.textContent).toContain('Provider reviewed blood pressure management.')
    expect(browserReport.querySelector('.clinical-report-masthead')).toBeNull()

    await clickButton(mounted.container, 'Print preview')

    const dialog = mounted.container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('.clinical-report-masthead')).not.toBeNull()
    expect(dialog?.textContent).toContain('Community Health Screening')

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const previousTitle = document.title
    await clickButton(mounted.container, 'Print')
    expect(printSpy).toHaveBeenCalledOnce()
    expect(document.title).toBe(previousTitle)

    await mounted.unmount()
  })

  it('creates focused Vitals, Lifestyle, and Referrals reports with exact record links', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)
    await clickRow(mounted.container, 'Suzana Fuavesan')

    await clickButton(mounted.container, 'Vitals')
    expect(reportHeadings(mounted.container)).toEqual(['Vitals'])
    expect(reportDocument(mounted.container).textContent).toContain('Vitals report')

    await clickButton(mounted.container, 'Lifestyle')
    expect(reportHeadings(mounted.container)).toEqual(['Lifestyle'])
    expect(reportDocument(mounted.container).textContent).toContain('Lifestyle report')
    expect(reportDocument(mounted.container).textContent).not.toContain('Blood pressure screening')

    await clickButton(mounted.container, 'Referrals')
    expect(reportHeadings(mounted.container)).toEqual(['Referrals'])
    expect(reportDocument(mounted.container).textContent).toContain('Patient reached by phone')
    expect(reportDocument(mounted.container).textContent).toContain('Amlodipine')

    const referralRecord = mounted.container.querySelector('.patient-report-referral-record')
    if (!(referralRecord instanceof HTMLElement)) throw new Error('Missing referral record')
    await clickButton(referralRecord, 'Open referral')
    await clickButton(referralRecord, 'Open encounter')
    expect(harness.onOpenReferral).toHaveBeenCalledWith(referralId)
    expect(harness.onOpenEncounter).toHaveBeenCalledWith(encounterId)

    await mounted.unmount()
  })

  it('applies a custom inclusive date range and reloads the selected report', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)
    await clickRow(mounted.container, 'Suzana Fuavesan')

    const inputs = mounted.container.querySelectorAll<HTMLInputElement>('input[type="date"]')
    await setInputValue(inputs[0], '2026-09-01')
    await setInputValue(inputs[1], '2026-09-04')
    await clickButton(mounted.container, 'Apply dates')

    expect(reportDocument(mounted.container).textContent).toContain('Sep 1, 2026 to Sep 4, 2026')
    expect(harness.getPatientHistory).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })
})

interface Harness {
  readonly api: HealthScreeningApi
  readonly searchPatients: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  readonly getPatientHistory: ReturnType<
    typeof vi.fn<HealthScreeningApi['screeningEncounters']['management']['getPatientHistory']>
  >
  readonly getEncounterDetail: ReturnType<
    typeof vi.fn<HealthScreeningApi['screeningEncounters']['management']['getDetail']>
  >
  readonly searchReferrals: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['search']>>
  readonly getReferralDetail: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['getDetail']>>
  readonly onOpenEncounter: ReturnType<typeof vi.fn<(encounterId: string) => void>>
  readonly onOpenReferral: ReturnType<typeof vi.fn<(referralId: string) => void>>
}

interface MountedWorkspace {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

function createHarness(): Harness {
  const searchPatients = vi.fn<HealthScreeningApi['patient']['search']>(() =>
    Promise.resolve(createIpcSuccess({ items: [patientSummary], page: 1, pageSize: 25, total: 1 }))
  )
  const getPatient = vi.fn<HealthScreeningApi['patient']['get']>(() =>
    Promise.resolve(createIpcSuccess(patientDetail))
  )
  const getPatientHistory = vi.fn<
    HealthScreeningApi['screeningEncounters']['management']['getPatientHistory']
  >(() => Promise.resolve(createIpcSuccess({ status: 'LOADED', history })))
  const getEncounterDetail = vi.fn<
    HealthScreeningApi['screeningEncounters']['management']['getDetail']
  >(({ encounterId: requestedId }) =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        detail: encounterDetails.find((detail) => detail.encounter.id === requestedId)!
      })
    )
  )
  const searchReferrals = vi.fn<HealthScreeningApi['referrals']['search']>(() =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        items: [referralSummary],
        total: 1,
        page: 1,
        pageSize: 100
      })
    )
  )
  const getReferralDetail = vi.fn<HealthScreeningApi['referrals']['getDetail']>(() =>
    Promise.resolve(createIpcSuccess({ status: 'LOADED', detail: referralDetail }))
  )
  return {
    searchPatients,
    getPatientHistory,
    getEncounterDetail,
    searchReferrals,
    getReferralDetail,
    onOpenEncounter: vi.fn(),
    onOpenReferral: vi.fn(),
    api: {
      patient: { search: searchPatients, get: getPatient },
      screeningEncounters: {
        management: { getPatientHistory, getDetail: getEncounterDetail }
      },
      referrals: { search: searchReferrals, getDetail: getReferralDetail }
    } as unknown as HealthScreeningApi
  }
}

function createEncounterDetail(
  id: string,
  completedAt: string,
  sections: Pick<PublicManagedEncounterDetail, 'lifestyle' | 'foods' | 'otcMedications'> & {
    readonly systolic: number
    readonly diastolic: number
    readonly pulse: number
  }
): PublicManagedEncounterDetail {
  return {
    encounter: {
      id,
      patientId,
      screeningSessionId,
      patientCode: patientSummary.patientCode,
      patientDisplayName: patientSummary.displayName,
      dateOfBirth: patientSummary.dateOfBirth,
      locationName: 'Babungo',
      status: 'COMPLETED',
      startedAt: completedAt,
      completedAt,
      noteCount: 0,
      openFlagCount: 0,
      recordVersion: 1,
      hasRecordedData: true
    },
    vitals: [
      {
        sequenceNumber: 1,
        systolic: sections.systolic,
        diastolic: sections.diastolic,
        pulse: sections.pulse,
        measuredAt: completedAt
      }
    ],
    lifestyle: sections.lifestyle,
    foods: sections.foods,
    otcMedications: sections.otcMedications,
    addenda: [],
    flags: []
  }
}

async function mount(harness: Harness): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(PatientReportsWorkspace, {
        api: harness.api,
        timeZone: 'Africa/Douala',
        headingId: 'patient-reports-heading',
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

function reportDocument(container: HTMLElement): HTMLElement {
  const document = container.querySelector('.patient-report-document.is-browser-report')
  if (!(document instanceof HTMLElement)) throw new Error('Missing browser report')
  return document
}

function reportHeadings(container: HTMLElement): readonly string[] {
  return Array.from(
    reportDocument(container).querySelectorAll('.patient-report-section-heading h3')
  )
    .map((heading) => heading.textContent?.trim() ?? '')
    .filter(Boolean)
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (button === undefined) throw new Error(`Missing button ${label}`)
  return button
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = buttonByText(container, label)
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
  })
  await act(flush)
}

async function clickRow(container: HTMLElement, label: string): Promise<void> {
  const row = Array.from(container.querySelectorAll('tr')).find((candidate) =>
    candidate.textContent?.includes(label)
  )
  if (row === undefined) throw new Error(`Missing row ${label}`)
  await act(async () => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
  })
  await act(flush)
}

async function setInputValue(input: HTMLInputElement | undefined, value: string): Promise<void> {
  if (input === undefined) throw new Error('Missing date input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}
