// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type HealthScreeningApi,
  type PublicPatientContextEncounter
} from '@shared/ipc'
import { PatientScreeningHistoryPanel } from '../../../src/renderer/src/app/patients/PatientScreeningHistoryPanel'

const patientId = '11111111-1111-4111-8111-111111111111'
const encounterId = '22222222-2222-4222-8222-222222222222'

describe('patient screening history panel', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders finalized history, trends, structured follow-up data, and exact encounter action', async () => {
    const getPatientHistory = vi.fn(() =>
      Promise.resolve(
        createIpcSuccess({
          status: 'LOADED' as const,
          history: {
            patientId,
            total: 1,
            page: 1,
            pageSize: 25 as const,
            thirtyDayAverage: { systolic: 146, diastolic: 92, encounterCount: 1 },
            trendEncounters: [contextEncounter()],
            items: [
              {
                ...contextEncounter(),
                referral: {
                  id: '33333333-3333-4333-8333-333333333333',
                  status: 'SEEN' as const,
                  urgency: 'STANDARD' as const,
                  dueDate: '2026-08-20',
                  closedAt: null,
                  latestFollowup: {
                    id: '44444444-4444-4444-8444-444444444444',
                    contactDate: '2026-08-18',
                    providerSeen: true,
                    reportedOutcome: 'Blood pressure treatment started.',
                    treatmentActions: ['TREATMENT_INITIATED' as const],
                    medicationChanges: [
                      {
                        id: '55555555-5555-4555-8555-555555555555',
                        changeType: 'NEW_MEDICATION' as const,
                        medicationName: 'Amlodipine',
                        dosage: '5 mg',
                        frequency: 'Daily'
                      }
                    ]
                  }
                }
              }
            ]
          }
        })
      )
    )
    const api = {
      screeningEncounters: { management: { getPatientHistory } }
    } as unknown as HealthScreeningApi
    const onOpenEncounter = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        createElement(PatientScreeningHistoryPanel, {
          api,
          patientId,
          onAuthenticationFailure: vi.fn(),
          onOpenEncounter
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getPatientHistory).toHaveBeenCalledWith({ patientId, page: 1, pageSize: 25 })
    expect(container.textContent).toContain('146 / 92')
    expect(container.textContent).toContain('Blood pressure treatment started.')
    expect(container.textContent).toContain('Amlodipine')

    const openButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Open encounter'
    )
    expect(openButton).toBeDefined()
    await act(async () => openButton?.click())
    expect(onOpenEncounter).toHaveBeenCalledWith(encounterId)

    await act(async () => root.unmount())
  })
})

function contextEncounter(): PublicPatientContextEncounter {
  return {
    id: encounterId,
    completedAt: '2026-08-18T10:00:00.000Z',
    systolic: 146,
    diastolic: 92,
    pulse: 76,
    nextAction: 'REFER' as const,
    weightKg: 71.5
  }
}
