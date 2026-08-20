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
  patientCode: 'PT-000001',
  patientDisplayName: 'Test Patient',
  dateOfBirth: '1980-01-02',
  locationName: 'Test Location',
  status: 'COMPLETED' as const,
  startedAt: '2026-08-20T11:00:00.000Z',
  completedAt: '2026-08-20T12:00:00.000Z',
  noteCount: 0,
  openFlagCount: 0
}

describe('manage encounters workspace', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
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
          resolveFlag: vi.fn()
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
          onAuthenticationFailure: vi.fn()
        })
      )
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
})

function button(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === label
    ) ?? null
  )
}
