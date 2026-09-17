// @vitest-environment jsdom
/// <reference lib="dom" />
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createIpcSuccess } from '@shared/ipc'
import type { ProtocolApi, ProtocolResult } from '@shared/ipc/protocol-contracts'
import {
  SCREENING_BP_PROTOCOL_V1,
  evaluateScreeningBloodPressure
} from '@shared/screening-bp-protocol'
import { ProtocolsWorkspace } from '../../../src/renderer/src/app/administration/ProtocolsWorkspace'

const active = {
  key: 'health-screening-baseline',
  version: '1',
  effectiveAt: '1970-01-01T00:00:00.000Z',
  rulesMatch: true
}
let root: Root
let container: HTMLElement
let get: ReturnType<typeof vi.fn<ProtocolApi['get']>>
const authenticate = vi.fn()
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  get = vi.fn<ProtocolApi['get']>(async () => createIpcSuccess({ status: 'LOADED', active }))
  authenticate.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function mount(role: 'LOCAL_ADMIN' | 'NURSE' = 'LOCAL_ADMIN'): Promise<void> {
  await act(async () =>
    root.render(
      createElement(ProtocolsWorkspace, {
        api: { get },
        userRole: role,
        headingId: 'protocol-heading',
        headingRef: { current: null },
        onAuthenticationFailure: authenticate
      })
    )
  )
}
async function refresh(): Promise<void> {
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
}

describe('Protocols workspace', () => {
  it('shows active metadata, current thresholds and calculation behavior without edit controls', async () => {
    await mount()
    expect(container.textContent).toContain('Health screening baseline')
    expect(container.textContent).toContain('Bundled baseline — no dated start')
    expect(container.textContent).toContain('matches the rules used')
    expect(container.textContent).toContain(
      `${SCREENING_BP_PROTOCOL_V1.configuration.initialRestMinutes} minutes of initial rest`
    )
    expect(container.textContent).toContain(
      `at least ${SCREENING_BP_PROTOCOL_V1.configuration.repeatIntervalMinutes} minute`
    )
    expect(container.textContent).toContain('mean of the last two readings in sequence order')
    expect(container.textContent).toContain('rounded to the nearest whole number')
    expect(container.textContent).toContain('Screening guidance is not a diagnosis.')
    expect([...container.querySelectorAll('tbody th')].map((node) => node.textContent)).toEqual([
      'Repeat required',
      'Urgent referral',
      'Standard referral',
      'Routine'
    ])
    expect(container.querySelector('input,select,textarea,form')).toBeNull()
    expect([...container.querySelectorAll('button')].map((node) => node.textContent)).toEqual([
      'Refresh'
    ])
  })
  it('describes urgent evaluation using the latest reading or mean, matching the real evaluator', async () => {
    await mount()
    const urgent = [...container.querySelectorAll('tbody tr')].find((row) =>
      row.textContent?.startsWith('Urgent referral')
    )!
    const c = SCREENING_BP_PROTOCOL_V1.configuration
    expect(urgent.textContent).toContain(
      `systolic ≥ ${c.urgentSystolicThreshold} or diastolic ≥ ${c.urgentDiastolicThreshold}`
    )
    expect(urgent.textContent).toContain('latest reading or the rounded mean')
    const reading = (
      sequenceNumber: number,
      systolic: number,
      diastolic: number
    ): { sequenceNumber: number; systolic: number; diastolic: number; pulse: number } => ({
      sequenceNumber,
      systolic,
      diastolic,
      pulse: 70
    })
    // Latest is urgent even though the mean is below the standard referral threshold.
    expect(
      evaluateScreeningBloodPressure([reading(1, 80, 60), reading(2, 180, 60)])?.nextAction
    ).toBe('URGENT_REFERRAL')
    // Mean is urgent even though the latest reading is below the urgent threshold.
    expect(
      evaluateScreeningBloodPressure([reading(1, 200, 80), reading(2, 160, 80)])?.nextAction
    ).toBe('URGENT_REFERRAL')
    expect(evaluateScreeningBloodPressure([reading(1, 120, 120)])?.nextAction).toBe(
      'REPEAT_REQUIRED'
    )
  })
  it('warns about mismatches and still labels the reference as the rules currently used', async () => {
    get.mockResolvedValue(
      createIpcSuccess({ status: 'LOADED', active: { ...active, rulesMatch: false } })
    )
    await mount()
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      'differs from the rules used'
    )
    expect(container.querySelector('table')).not.toBeNull()
  })
  it('does not invent an active version when no protocol is recorded', async () => {
    get.mockResolvedValue(createIpcSuccess({ status: 'NO_ACTIVE_PROTOCOL' }))
    await mount()
    expect(container.querySelector('[role=alert]')?.textContent).toContain(
      'No active protocol is recorded'
    )
    expect(container.querySelector('#active-protocol-title')).toBeNull()
    expect(container.textContent).toContain('Rules version 1')
  })
  it('clears stale metadata on refresh, sanitizes failure and supports retry', async () => {
    await mount()
    get.mockRejectedValueOnce(new Error('/private/database path'))
    await refresh()
    expect(container.textContent).not.toContain('/private/database')
    expect(container.querySelector('#active-protocol-title')).toBeNull()
    expect(container.querySelector('[role=alert]')?.textContent).toContain('could not be loaded')
    await refresh()
    expect(container.textContent).toContain('matches the rules used')
  })
  it.each(['AUTHENTICATION_REQUIRED', 'FORBIDDEN'] as const)(
    'handles %s without displaying rules as authorized',
    async (status) => {
      get.mockResolvedValue(createIpcSuccess({ status }))
      await mount()
      expect(authenticate).toHaveBeenCalledWith(
        status === 'FORBIDDEN' ? 'AUTHORIZATION_FAILED' : 'AUTH_UNAUTHENTICATED'
      )
      expect(container.querySelector('table')).toBeNull()
    }
  )
  it('does not request data for nurses', async () => {
    await mount('NURSE')
    expect(get).not.toHaveBeenCalled()
    expect(container.querySelector('button')).toBeNull()
  })
  it('ignores responses after unmount, including authentication failures', async () => {
    let finish!: (result: ProtocolResult) => void
    get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await mount()
    expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
    await act(async () => root.render(null))
    await act(async () => finish(createIpcSuccess({ status: 'AUTHENTICATION_REQUIRED' })))
    expect(authenticate).not.toHaveBeenCalled()
  })
})
