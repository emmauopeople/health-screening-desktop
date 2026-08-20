// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createIpcSuccess, type HealthScreeningApi } from '@shared/ipc'
import { ManageEncountersWorkspace } from '../../../src/renderer/src/app/screening/manage/ManageEncountersWorkspace'

const encounter = {
  id: '53000000-0000-4000-8000-000000000001',
  patientId: '53000000-0000-4000-8000-000000000002',
  screeningSessionId: '53000000-0000-4000-8000-000000000003',
  patientCode: 'PT-000001',
  patientDisplayName: 'Test Patient',
  dateOfBirth: '1980-01-02',
  locationName: 'Test Location',
  status: 'COMPLETED' as const,
  startedAt: '2026-08-20T11:00:00.000Z',
  completedAt: '2026-08-20T12:00:00.000Z',
  noteCount: 0,
  openFlagCount: 0,
  recordVersion: 1,
  hasRecordedData: true
}

describe('manage encounters workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders finalized sections read-only and provides append-only management actions', async () => {
    const search = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          items: [encounter],
          total: 1,
          page: 1,
          pageSize: 50 as const
        })
      )
    )
    const getDetail = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          detail: {
            encounter,
            vitals: [
              {
                sequenceNumber: 1,
                systolic: 120,
                diastolic: 80,
                pulse: 70,
                measuredAt: '2026-08-20T11:05:00.000Z'
              }
            ],
            lifestyle: [{ questionCode: 'ALCOHOL_WEEKLY', responseCode: 'NO' }],
            foods: [{ foodName: 'Leafy greens', frequencyCode: 'EVERY_DAY', notes: null }],
            otcMedications: [
              { productName: 'Pain reliever', reasonForUse: 'Headache', currentlyTaking: true }
            ],
            addenda: [],
            flags: []
          }
        })
      )
    )
    const api = {
      screeningEncounters: {
        management: {
          search,
          getDetail,
          addAddendum: vi.fn(),
          openFlag: vi.fn(),
          resolveFlag: vi.fn(),
          voidEmptyDraft: vi.fn()
        }
      }
    } as unknown as HealthScreeningApi
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ManageEncountersWorkspace, {
          api,
          headingId: 'manage-heading',
          headingRef: createRef<HTMLHeadingElement>(),
          onAuthenticationFailure: vi.fn(),
          onResumeDraft: vi.fn(() => true)
        })
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(search).toHaveBeenCalledWith({ query: '', status: 'ALL', page: 1, pageSize: 50 })
    expect(getDetail).toHaveBeenCalledWith({ encounterId: encounter.id })
    expect(container.querySelector('.manage-encounters-layout')).not.toBeNull()
    expect(container.querySelector('.manage-encounters-results')).not.toBeNull()
    expect(container.querySelector('.manage-encounter-detail')).not.toBeNull()
    expect(container.textContent).toContain('Manage Encounters')
    expect(container.textContent).toContain('Reading 1: 120/80 mmHg · HR 70')
    expect(container.textContent).toContain('Alcohol weekly: No')
    expect(container.textContent).toContain('Leafy greens · Every day')
    expect(container.textContent).toContain('Pain reliever · Headache · Currently taking')
    expect(button(container, 'Add note')).not.toBeNull()
    expect(button(container, 'Flag for review')).not.toBeNull()
    expect(container.textContent).not.toContain('Edit')
    expect(container.textContent).not.toContain('Reopen')

    await act(async () => root.unmount())
  })

  it('searches after three characters without a button and filters immediately by status', async () => {
    vi.useFakeTimers()
    const search = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          items: [],
          total: 0,
          page: 1,
          pageSize: 50 as const
        })
      )
    )
    const api = {
      screeningEncounters: {
        management: {
          search,
          getDetail: vi.fn(),
          addAddendum: vi.fn(),
          openFlag: vi.fn(),
          resolveFlag: vi.fn(),
          voidEmptyDraft: vi.fn()
        }
      }
    } as unknown as HealthScreeningApi
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ManageEncountersWorkspace, {
          api,
          headingId: 'manage-heading',
          headingRef: createRef<HTMLHeadingElement>(),
          onAuthenticationFailure: vi.fn(),
          onResumeDraft: vi.fn(() => true)
        })
      )
    })
    await act(async () => vi.runOnlyPendingTimersAsync())
    expect(search).toHaveBeenCalledTimes(1)
    expect(button(container, 'Search')).toBeNull()

    const queryInput = container.querySelector<HTMLInputElement>('#manage-encounters-query')!
    await act(async () => changeInput(queryInput, 'Te'))
    await act(async () => vi.advanceTimersByTimeAsync(400))
    expect(search).toHaveBeenCalledTimes(1)

    await act(async () => changeInput(queryInput, 'Tes'))
    await act(async () => vi.advanceTimersByTimeAsync(299))
    expect(search).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(search).toHaveBeenLastCalledWith({
      query: 'Tes',
      status: 'ALL',
      page: 1,
      pageSize: 50
    })

    const status = container.querySelector<HTMLSelectElement>('#manage-encounters-status')!
    await act(async () => changeInput(status, 'DRAFT', 'change'))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(search).toHaveBeenLastCalledWith({
      query: 'Tes',
      status: 'DRAFT',
      page: 1,
      pageSize: 50
    })

    await act(async () => root.unmount())
  })

  it('resumes drafts with saved data without offering the void action', async () => {
    const draftEncounter = {
      ...encounter,
      status: 'DRAFT' as const,
      completedAt: null,
      hasRecordedData: true
    }
    const search = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          items: [draftEncounter],
          total: 1,
          page: 1,
          pageSize: 50 as const
        })
      )
    )
    const getDetail = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          detail: {
            encounter: draftEncounter,
            vitals: [],
            lifestyle: [],
            foods: [],
            otcMedications: [],
            addenda: [],
            flags: []
          }
        })
      )
    )
    const patient = { id: draftEncounter.patientId, displayName: 'Test Patient' }
    const onResumeDraft = vi.fn(() => true)
    const api = {
      patient: { get: vi.fn(() => Promise.resolve(createIpcSuccess(patient))) },
      screeningEncounters: {
        management: {
          search,
          getDetail,
          addAddendum: vi.fn(),
          openFlag: vi.fn(),
          resolveFlag: vi.fn(),
          voidEmptyDraft: vi.fn()
        }
      }
    } as unknown as HealthScreeningApi
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ManageEncountersWorkspace, {
          api,
          headingId: 'manage-heading',
          headingRef: createRef<HTMLHeadingElement>(),
          onAuthenticationFailure: vi.fn(),
          onResumeDraft
        })
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Draft data saved')
    expect(button(container, 'Void empty draft')).toBeNull()
    const resume = button(container, 'Resume screening')!
    await act(async () => resume.click())
    expect(onResumeDraft).toHaveBeenCalledWith(
      patient,
      expect.objectContaining({ id: draftEncounter.id, status: 'DRAFT' })
    )

    await act(async () => root.unmount())
  })

  it('voids an empty draft only after a reason is confirmed', async () => {
    const emptyDraft = {
      ...encounter,
      status: 'DRAFT' as const,
      completedAt: null,
      hasRecordedData: false
    }
    const loaded = createIpcSuccess({
      status: 'LOADED' as const,
      items: [emptyDraft],
      total: 1,
      page: 1,
      pageSize: 50 as const
    })
    const voidEmptyDraft = vi.fn(() =>
      Promise.resolve(createIpcSuccess({ status: 'VOIDED' as const, recordVersion: 2 }))
    )
    const api = {
      screeningEncounters: {
        management: {
          search: vi.fn(() => Promise.resolve(loaded)),
          getDetail: vi.fn(() =>
            Promise.resolve(
              createIpcSuccess({
                status: 'LOADED' as const,
                detail: {
                  encounter: emptyDraft,
                  vitals: [],
                  lifestyle: [],
                  foods: [],
                  otcMedications: [],
                  addenda: [],
                  flags: []
                }
              })
            )
          ),
          addAddendum: vi.fn(),
          openFlag: vi.fn(),
          resolveFlag: vi.fn(),
          voidEmptyDraft
        }
      }
    } as unknown as HealthScreeningApi
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(ManageEncountersWorkspace, {
          api,
          headingId: 'manage-heading',
          headingRef: createRef<HTMLHeadingElement>(),
          onAuthenticationFailure: vi.fn(),
          onResumeDraft: vi.fn(() => true)
        })
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(button(container, 'Resume screening')).not.toBeNull()
    await act(async () => button(container, 'Void empty draft')!.click())
    const reason = container.querySelector<HTMLTextAreaElement>('#encounter-void-reason')!
    expect(button(container, 'Confirm void')!.disabled).toBe(true)
    await act(async () => changeInput(reason, 'Created without screening data.'))
    await act(async () => button(container, 'Confirm void')!.click())
    expect(voidEmptyDraft).toHaveBeenCalledWith({
      encounterId: emptyDraft.id,
      expectedVersion: 1,
      reason: 'Created without screening data.'
    })

    await act(async () => root.unmount())
  })
})

function button(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    ) ?? null
  )
}

function changeInput(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
  eventName = 'input'
): void {
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event(eventName, { bubbles: true }))
}
