// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicPatientDetail,
  type PublicReferralDetail,
  type PublicReferralSummary
} from '@shared/ipc'
import { ReferralWorklistWorkspace } from '../../../src/renderer/src/app/referrals/ReferralWorklistWorkspace'

const referralId = '11111111-1111-4111-8111-111111111111'
const requestedReferralId = '55555555-5555-4555-8555-555555555555'
const patientId = '22222222-2222-4222-8222-222222222222'
const summary: PublicReferralSummary = {
  id: referralId,
  patientId,
  encounterId: '33333333-3333-4333-8333-333333333333',
  patientCode: 'BAB-000184',
  patientDisplayName: 'Grace N.',
  urgency: 'URGENT',
  dueDate: '2026-08-28',
  status: 'OPEN',
  lastContactDate: null,
  recordVersion: 1,
  createdAt: '2026-08-27T10:35:00.000Z',
  updatedAt: '2026-08-27T10:35:00.000Z'
}
const detail: PublicReferralDetail = {
  ...summary,
  reasonCodes: ['BP_SCREENING_URGENT_REFERRAL'],
  reasonText: null,
  triggeringBloodPressure: { systolic: 178, diastolic: 112 },
  destinationName: null,
  closureReason: null,
  closedAt: null,
  statusHistory: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      fromStatus: null,
      toStatus: 'OPEN',
      changeReason: null,
      changedByDisplayName: 'Nurse E.',
      changedAt: '2026-08-27T10:35:00.000Z'
    }
  ],
  followups: []
}
const patientDetail: PublicPatientDetail = {
  id: patientId,
  patientCode: summary.patientCode,
  displayName: summary.patientDisplayName,
  givenName: 'Grace',
  familyName: 'N.',
  otherNames: null,
  dateOfBirth: '1975-04-12',
  approximateAgeYears: null,
  ageAsOfDate: null,
  sex: 'FEMALE',
  village: 'Babungo',
  quarter: null,
  phone: null,
  status: 'ACTIVE',
  rowVersion: 1,
  updatedAt: '2026-08-27T10:35:00.000Z',
  alternateContactName: null,
  alternateContactPhone: null,
  residenceNotes: null,
  acknowledgment: {
    status: 'NOT_REQUESTED',
    recordedAt: null,
    recordedByDisplayName: null
  },
  createdAt: '2026-08-27T10:35:00.000Z',
  createdByDisplayName: 'Nurse E.',
  updatedByDisplayName: 'Nurse E.',
  clinicalStatus: 'NOT_AVAILABLE'
}

describe('ReferralWorklistWorkspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('loads the active 25-row worklist and exact selected referral', async () => {
    const harness = createHarness()
    const mounted = await mount(harness.api)

    expect(harness.search).toHaveBeenCalledWith({
      query: '',
      statuses: ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM'],
      urgency: null,
      dueFrom: null,
      dueTo: null,
      screeningSessionId: null,
      page: 1,
      pageSize: 25
    })
    expect(harness.getDetail).toHaveBeenCalledWith({ referralId })
    expect(mounted.container.textContent).toContain('Grace N.')
    expect(mounted.container.textContent).toContain('BAB-000184')
    expect(mounted.container.textContent).toContain(
      'Urgent blood pressure screening referral — BP 178/112 mmHg'
    )
    expect(mounted.container.querySelector('.referral-list-pane')).not.toBeNull()
    expect(mounted.container.querySelector('.referral-detail-pane')).not.toBeNull()

    await mounted.unmount()
  })

  it('opens an exact referral requested from patient context even when it is not on the first page', async () => {
    const requestedDetail: PublicReferralDetail = {
      ...detail,
      id: requestedReferralId,
      patientDisplayName: 'Suzana Fuavesan',
      patientCode: 'PT-000003',
      status: 'CONTACTED'
    }
    const onRequestedReferralConsumed = vi.fn()
    const harness = createHarness()
    harness.getDetail.mockImplementation(({ referralId: detailReferralId }) =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED',
          detail: detailReferralId === requestedReferralId ? requestedDetail : detail
        })
      )
    )

    const mounted = await mount(harness.api, vi.fn(), vi.fn(), {
      requestedReferralId,
      onRequestedReferralConsumed
    })

    expect(harness.getDetail).toHaveBeenCalledWith({ referralId: requestedReferralId })
    expect(mounted.container.textContent).toContain('Suzana Fuavesan')
    expect(mounted.container.textContent).toContain('PT-000003')
    expect(onRequestedReferralConsumed).toHaveBeenCalledOnce()

    await mounted.unmount()
  })

  it('uses the record version for status and follow-up mutations and opens the exact patient', async () => {
    const onOpenPatient = vi.fn()
    const onOpenEncounter = vi.fn()
    const harness = createHarness()
    harness.updateStatus.mockResolvedValue(
      createIpcSuccess({ status: 'UPDATED', detail: { ...detail, recordVersion: 2 } })
    )
    harness.recordFollowup.mockResolvedValue(
      createIpcSuccess({ status: 'UPDATED', detail: { ...detail, recordVersion: 2 } })
    )
    const mounted = await mount(harness.api, onOpenPatient, onOpenEncounter)

    await click(mounted.container, 'Open patient')
    expect(onOpenPatient).toHaveBeenCalledWith(patientId)
    await click(mounted.container, 'Open screening')
    expect(onOpenEncounter).toHaveBeenCalledWith(summary.encounterId)

    await change(
      mounted.container.querySelector<HTMLSelectElement>('.referral-status-action select')!,
      'CONTACTED'
    )
    await click(mounted.container, 'Save status')
    expect(harness.updateStatus).toHaveBeenCalledWith({
      referralId,
      expectedVersion: 1,
      status: 'CONTACTED',
      reason: null
    })

    await click(mounted.container, 'Record follow-up')
    await click(mounted.container, 'Save follow-up')
    expect(harness.recordFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId,
        expectedVersion: 2,
        contactMethod: 'PHONE',
        informationSource: 'PATIENT',
        sourceType: 'DIRECT_FOLLOWUP',
        newStatus: 'CONTACTED'
      })
    )

    await mounted.unmount()
  })

  it('shows visit actions only after provider seen and submits structured medication data', async () => {
    const harness = createHarness()
    const mounted = await mount(harness.api)

    await click(mounted.container, 'Record follow-up')
    expect(mounted.container.textContent).not.toContain('Visit actions')

    const providerSeen = Array.from(mounted.container.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('Provider seen'))
      ?.querySelector('select')
    if (providerSeen === null || providerSeen === undefined)
      throw new Error('Missing provider seen control')
    await change(providerSeen, 'YES')
    expect(mounted.container.textContent).toContain('Visit actions')

    await check(mounted.container, 'New medication')
    const medicationInputs = mounted.container.querySelectorAll<HTMLInputElement>(
      '.referral-medication-row input'
    )
    expect(medicationInputs).toHaveLength(3)
    await input(medicationInputs[0]!, 'Amlodipine')
    await input(medicationInputs[1]!, '5 mg')
    await input(medicationInputs[2]!, 'Once daily')
    const reportedOutcome = Array.from(mounted.container.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('Reported outcome'))
      ?.querySelector('textarea')
    if (reportedOutcome === null || reportedOutcome === undefined)
      throw new Error('Missing reported outcome control')
    await input(reportedOutcome, 'Provider initiated blood pressure treatment.')

    await click(mounted.container, 'Save follow-up')
    expect(harness.recordFollowup).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSeen: true,
        reportedOutcome: 'Provider initiated blood pressure treatment.',
        treatmentActions: ['NEW_MEDICATION'],
        medicationChanges: [
          {
            changeType: 'NEW_MEDICATION',
            medicationName: 'Amlodipine',
            dosage: '5 mg',
            frequency: 'Once daily'
          }
        ]
      })
    )

    await mounted.unmount()
  })

  it('loads active referrals due today or earlier in Follow-up Due', async () => {
    const harness = createHarness()
    const mounted = await mount(harness.api, vi.fn(), vi.fn(), null, 'FOLLOW_UP_DUE')

    expect(mounted.container.querySelector('h1')?.textContent).toBe('Follow-up Due')
    expect(harness.search).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: ['OPEN', 'CONTACTED', 'SEEN', 'UNABLE_TO_CONFIRM'],
        dueFrom: null,
        dueTo: new Date().toISOString().slice(0, 10)
      })
    )
    expect(mounted.container.textContent).toContain('Record follow-up')
    expect(
      Array.from(mounted.container.querySelectorAll('label')).some(
        (label) => label.textContent === 'Due'
      )
    ).toBe(false)

    await mounted.unmount()
  })

  it('closes an active referral only after a closure reason is entered', async () => {
    const harness = createHarness()
    harness.updateStatus.mockResolvedValue(
      createIpcSuccess({
        status: 'UPDATED',
        detail: { ...detail, status: 'CLOSED', closureReason: 'Care completed', recordVersion: 2 }
      })
    )
    const mounted = await mount(harness.api, vi.fn(), vi.fn(), null, 'CLOSE_REFERRAL')

    expect(mounted.container.querySelector('h1')?.textContent).toBe('Close Referral')
    expect(mounted.container.textContent).not.toContain('Record follow-up')
    const closeButton = button(mounted.container, 'Close referral')
    expect(closeButton.disabled).toBe(true)
    const reason = mounted.container.querySelector<HTMLInputElement>(
      'input[aria-label="Closure reason"]'
    )
    if (reason === null) throw new Error('Missing closure reason')
    await input(reason, 'Care completed')
    expect(closeButton.disabled).toBe(false)
    await click(mounted.container, 'Close referral')
    expect(harness.updateStatus).toHaveBeenCalledWith({
      referralId,
      expectedVersion: 1,
      status: 'CLOSED',
      reason: 'Care completed'
    })

    await mounted.unmount()
  })

  it('opens a read-only patient-specific referral PDF from Print Queue', async () => {
    const harness = createHarness()
    const mounted = await mount(harness.api, vi.fn(), vi.fn(), null, 'PRINT_QUEUE')

    expect(mounted.container.querySelector('h1')?.textContent).toBe('Print Queue')
    expect(mounted.container.textContent).not.toContain('Update status')
    expect(mounted.container.textContent).not.toContain('Record follow-up')
    await click(mounted.container, 'Open print preview')
    expect(harness.getPatient).toHaveBeenCalledWith({ patientId })
    const preview = mounted.container.querySelector('[role="dialog"]')
    expect(preview?.textContent).toContain('Referral print preview')
    expect(preview?.textContent).toContain('Bp screening urgent referral - BP 178/112 mmHg')
    expect(preview?.querySelector('[data-report-chart]')).toBeNull()
    await click(mounted.container, 'Save PDF')
    expect(harness.savePdf).toHaveBeenCalledWith({
      patientId,
      reportKind: 'REFERRALS',
      suggestedFileName: 'CHS-referral-BAB-000184.pdf'
    })

    await mounted.unmount()
  })
})

interface ReferralHarness {
  readonly search: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['search']>>
  readonly getDetail: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['getDetail']>>
  readonly updateStatus: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['updateStatus']>>
  readonly recordFollowup: ReturnType<
    typeof vi.fn<HealthScreeningApi['referrals']['recordFollowup']>
  >
  readonly getPatient: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['get']>>
  readonly savePdf: ReturnType<typeof vi.fn<HealthScreeningApi['reportDocuments']['savePdf']>>
  readonly api: HealthScreeningApi
}

interface MountedWorkspace {
  readonly container: HTMLElement
  unmount(): Promise<void>
}

function createHarness(): ReferralHarness {
  const search = vi.fn<HealthScreeningApi['referrals']['search']>(() =>
    Promise.resolve(
      createIpcSuccess({ status: 'LOADED', items: [summary], total: 1, page: 1, pageSize: 25 })
    )
  )
  const getDetail = vi.fn<HealthScreeningApi['referrals']['getDetail']>(() =>
    Promise.resolve(createIpcSuccess({ status: 'LOADED', detail }))
  )
  const updateStatus = vi.fn<HealthScreeningApi['referrals']['updateStatus']>(() =>
    Promise.resolve(createIpcSuccess({ status: 'UPDATED', detail }))
  )
  const recordFollowup = vi.fn<HealthScreeningApi['referrals']['recordFollowup']>(() =>
    Promise.resolve(createIpcSuccess({ status: 'UPDATED', detail }))
  )
  const getPatient = vi.fn<HealthScreeningApi['patient']['get']>(() =>
    Promise.resolve(createIpcSuccess(patientDetail))
  )
  const savePdf = vi.fn<HealthScreeningApi['reportDocuments']['savePdf']>(() =>
    Promise.resolve(createIpcSuccess({ status: 'SAVED', fileName: 'referral.pdf' }))
  )
  return {
    search,
    getDetail,
    updateStatus,
    recordFollowup,
    getPatient,
    savePdf,
    api: {
      patient: { get: getPatient },
      referrals: { search, getDetail, updateStatus, recordFollowup },
      reportDocuments: {
        savePdf,
        print: vi.fn(async () => createIpcSuccess({ status: 'PRINTED' as const }))
      }
    } as unknown as HealthScreeningApi
  }
}

async function mount(
  api: HealthScreeningApi,
  onOpenPatient = vi.fn(),
  onOpenEncounter = vi.fn(),
  requestedReferral: {
    readonly requestedReferralId: string
    onRequestedReferralConsumed(): void
  } | null = null,
  mode: 'WORKLIST' | 'FOLLOW_UP_DUE' | 'CLOSE_REFERRAL' | 'PRINT_QUEUE' = 'WORKLIST'
): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(ReferralWorklistWorkspace, {
        api,
        mode,
        headingId: 'referral-heading',
        headingRef: { current: null },
        requestedReferralId: requestedReferral?.requestedReferralId,
        onRequestedReferralConsumed: requestedReferral?.onRequestedReferralConsumed,
        onAuthenticationFailure: vi.fn(),
        onOpenPatient,
        onOpenEncounter
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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (match === undefined) throw new Error(`Missing button ${label}`)
  return match
}

async function change(element: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

async function input(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

async function check(container: HTMLElement, label: string): Promise<void> {
  const input = Array.from(container.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.trim() === label)
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (input === null || input === undefined) throw new Error(`Missing checkbox ${label}`)
  await act(async () => {
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
  })
  await act(flush)
}

async function click(container: HTMLElement, label: string): Promise<void> {
  const target = button(container, label)
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flush()
  })
  await act(flush)
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => window.setTimeout(resolve, 0))
}
