// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicReferralDetail,
  type PublicReferralSummary
} from '@shared/ipc'
import { ReferralWorklistWorkspace } from '../../../src/renderer/src/app/referrals/ReferralWorklistWorkspace'

const referralId = '11111111-1111-4111-8111-111111111111'
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
})

interface ReferralHarness {
  readonly search: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['search']>>
  readonly getDetail: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['getDetail']>>
  readonly updateStatus: ReturnType<typeof vi.fn<HealthScreeningApi['referrals']['updateStatus']>>
  readonly recordFollowup: ReturnType<
    typeof vi.fn<HealthScreeningApi['referrals']['recordFollowup']>
  >
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
  return {
    search,
    getDetail,
    updateStatus,
    recordFollowup,
    api: {
      referrals: { search, getDetail, updateStatus, recordFollowup }
    } as unknown as HealthScreeningApi
  }
}

async function mount(
  api: HealthScreeningApi,
  onOpenPatient = vi.fn(),
  onOpenEncounter = vi.fn()
): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(ReferralWorklistWorkspace, {
        api,
        headingId: 'referral-heading',
        headingRef: { current: null },
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

async function change(element: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
