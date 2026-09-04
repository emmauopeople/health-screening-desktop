// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicPatientDetail,
  type PublicPatientScreeningHistory,
  type PublicPatientSummary
} from '@shared/ipc'
import { PatientReportsWorkspace } from '../../../src/renderer/src/app/reports/PatientReportsWorkspace'

const patientId = '11111111-1111-4111-8111-111111111111'
const encounterId = '22222222-2222-4222-8222-222222222222'
const referralId = '33333333-3333-4333-8333-333333333333'

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
  alternateContactName: 'Family Contact',
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
        latestFollowup: {
          id: '44444444-4444-4444-8444-444444444444',
          contactDate: '2026-09-04',
          providerSeen: true,
          reportedOutcome: 'Provider reviewed blood pressure management.',
          treatmentActions: ['TREATMENT_INITIATED'],
          medicationChanges: []
        }
      }
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
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
  trendEncounters: [
    {
      id: encounterId,
      completedAt: '2026-09-03T10:00:00.000Z',
      systolic: 130,
      diastolic: 63,
      pulse: 77,
      nextAction: 'ROUTINE',
      weightKg: 68.5
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      completedAt: '2026-08-26T10:00:00.000Z',
      systolic: 103,
      diastolic: 91,
      pulse: 77,
      nextAction: 'REFER',
      weightKg: null
    }
  ],
  thirtyDayAverage: { systolic: 117, diastolic: 77, encounterCount: 2 }
}

describe('PatientReportsWorkspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('searches patients and renders a printable patient screening report', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    expect(harness.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(buttonByText(mounted.container, 'Create PDF report').disabled).toBe(true)

    await clickRow(mounted.container, 'Suzana Fuavesan')

    expect(harness.getPatient).toHaveBeenCalledWith({ patientId })
    expect(harness.getPatientHistory).toHaveBeenCalledWith({
      patientId,
      page: 1,
      pageSize: 100
    })
    expect(mounted.container.textContent).toContain('Patient screening report')
    expect(mounted.container.textContent).toContain('Suzana Fuavesan')
    expect(mounted.container.textContent).toContain('PT-000003')
    expect(mounted.container.textContent).toContain('Jan 15, 1998')
    expect(mounted.container.textContent).toContain('Babungo / Mbukang')
    expect(mounted.container.textContent).toContain('117 / 77')
    expect(mounted.container.textContent).toContain('Provider reviewed blood pressure management.')

    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const previousTitle = document.title
    await clickButton(mounted.container, 'Create PDF report')
    expect(printSpy).toHaveBeenCalledOnce()
    expect(document.title).toBe(previousTitle)

    await mounted.unmount()
  })

  it('opens the exact encounter and referral from the selected patient report', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    await clickRow(mounted.container, 'Suzana Fuavesan')
    await clickButton(mounted.container, 'Open encounter')
    await clickButton(mounted.container, 'Contacted • Standard')

    expect(harness.onOpenEncounter).toHaveBeenCalledWith(encounterId)
    expect(harness.onOpenReferral).toHaveBeenCalledWith(referralId)

    await mounted.unmount()
  })
})

interface Harness {
  readonly api: HealthScreeningApi
  readonly search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  readonly getPatient: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['get']>>
  readonly getPatientHistory: ReturnType<
    typeof vi.fn<HealthScreeningApi['screeningEncounters']['management']['getPatientHistory']>
  >
  readonly onOpenEncounter: ReturnType<typeof vi.fn<(encounterId: string) => void>>
  readonly onOpenReferral: ReturnType<typeof vi.fn<(referralId: string) => void>>
}

interface MountedWorkspace {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

function createHarness(): Harness {
  const search = vi.fn<HealthScreeningApi['patient']['search']>(() =>
    Promise.resolve(createIpcSuccess({ items: [patientSummary], page: 1, pageSize: 25, total: 1 }))
  )
  const getPatient = vi.fn<HealthScreeningApi['patient']['get']>(() =>
    Promise.resolve(createIpcSuccess(patientDetail))
  )
  const getPatientHistory = vi.fn<
    HealthScreeningApi['screeningEncounters']['management']['getPatientHistory']
  >(() => Promise.resolve(createIpcSuccess({ status: 'LOADED', history })))
  return {
    search,
    getPatient,
    getPatientHistory,
    onOpenEncounter: vi.fn(),
    onOpenReferral: vi.fn(),
    api: {
      patient: { search, get: getPatient },
      screeningEncounters: { management: { getPatientHistory } }
    } as unknown as HealthScreeningApi
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

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}
