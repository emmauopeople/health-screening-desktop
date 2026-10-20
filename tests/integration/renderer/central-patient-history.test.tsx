// @vitest-environment jsdom
/// <reference lib="dom" />
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CentralPatientHistoryPanel } from '../../../src/renderer/src/app/central-history/CentralPatientHistoryPanel'
import type {
  CentralHistoryApi,
  CentralHistoryReadResult,
  CentralHistoryRefreshResult
} from '@shared/ipc/central-history-contracts'
import { allDomainHistory, historyUuid } from '../../fixtures/central-history/history-fixture'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
const ready = (): CentralHistoryReadResult => ({
  ok: true,
  data: {
    status: 'READY',
    snapshotId: historyUuid(7),
    savedAt: '2026-09-17T12:00:00.000Z',
    page: allDomainHistory(),
    offset: 0,
    nextOffset: null,
    total: 11
  }
})

interface MountedHistory {
  api: {
    read: ReturnType<typeof vi.fn<CentralHistoryApi['read']>>
    refresh: ReturnType<typeof vi.fn<CentralHistoryApi['refresh']>>
  }
  invalidate(): void
  onAuthenticationFailure: ReturnType<typeof vi.fn>
}
async function mount(): Promise<MountedHistory> {
  const api = {
    read: vi.fn<CentralHistoryApi['read']>().mockResolvedValue(ready()),
    refresh: vi
      .fn<CentralHistoryApi['refresh']>()
      .mockResolvedValue({ ok: true, data: { status: 'COMPLETE', downloaded: 11 } })
  }
  const securityEpochRef = { current: 0 }
  let invalidate = (): void => {}
  const onAuthenticationFailure = vi.fn()
  await act(async () =>
    root.render(
      createElement(CentralPatientHistoryPanel, {
        api,
        patientId: historyUuid(1),
        securityEpochRef,
        registerStateInvalidator: (callback) => {
          invalidate = callback
          return () => {}
        },
        onAuthenticationFailure
      })
    )
  )
  return {
    api,
    invalidate: () => {
      securityEpochRef.current++
      invalidate()
    },
    onAuthenticationFailure
  }
}
async function click(text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text
  )
  if (!button) throw new Error(`Button missing: ${text}`)
  await act(async () => button.click())
}
async function reason(value = 'CARE_DELIVERY'): Promise<void> {
  const select = container.querySelector('select')!
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('central history desktop panel', () => {
  it('requires an explicit reason and shows all domains, authors, source labels and clinical units', async () => {
    const h = await mount()
    await click('View saved history')
    expect(h.api.read).not.toHaveBeenCalled()
    await reason()
    await click('View saved history')
    expect(h.api.read).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: historyUuid(1), reasonCode: 'CARE_DELIVERY', offset: 0 })
    )
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(11)
    for (const text of [
      'Synthetic Patient',
      'Central · read-only',
      'Synthetic Clinic',
      'Synthetic Nurse',
      'Systolic BP (mmHg)',
      'Weight (kg)',
      'Referral follow-up',
      'Up-hill clinic',
      'Increase physical activity',
      'Amlodipine',
      'Saved range:'
    ]) {
      expect(container.textContent).toContain(text)
    }
    expect(
      container.querySelectorAll(
        '.central-history-card input, .central-history-card textarea, .central-history-card button'
      )
    ).toHaveLength(0)
    await click('Close history')
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(0)
    expect(document.activeElement?.textContent).toBe('Central history')
  })

  it('keeps saved history visible when offline but clears it when access is denied', async () => {
    const h = await mount()
    await reason()
    await click('View saved history')
    h.api.refresh.mockResolvedValueOnce({ ok: true, data: { status: 'OFFLINE' } })
    await click('Refresh from central')
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(11)
    expect(container.textContent).toContain('could not be reached')
    h.api.refresh.mockResolvedValueOnce({ ok: true, data: { status: 'ACCESS_DENIED' } })
    await click('Refresh from central')
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(0)
    expect(container.textContent).toContain('Saved history has been removed')
  })

  it('pauses between pages and resumes without starting a second snapshot', async () => {
    const h = await mount()
    let resolve!: (result: CentralHistoryRefreshResult) => void
    h.api.refresh.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await reason()
    await click('Refresh from central')
    await click('Pause download')
    await act(async () => resolve({ ok: true, data: { status: 'IN_PROGRESS', downloaded: 50 } }))
    expect(h.api.refresh).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Download paused after 50 records')
    await click('Continue download')
    expect(h.api.refresh.mock.calls[1]?.[0].restart).toBe(false)
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(11)
  })

  it('ignores late responses and erases loaded data after security invalidation', async () => {
    const h = await mount()
    await reason()
    await click('View saved history')
    let resolve!: (result: CentralHistoryReadResult) => void
    h.api.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await click('View saved history')
    await act(async () => h.invalidate())
    await act(async () => resolve(ready()))
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(0)
    expect(container.textContent).not.toContain('Synthetic Patient')
  })

  it('uses snapshot-bound local pagination and resets when changing reason', async () => {
    const h = await mount()
    const first = ready()
    if (!first.ok || first.data.status !== 'READY') throw new Error('Fixture invalid')
    h.api.read.mockResolvedValueOnce({
      ok: true,
      data: { ...first.data, nextOffset: 11, total: 20 }
    })
    await reason()
    await click('View saved history')
    await click('Next page')
    expect(h.api.read.mock.calls[1]?.[0]).toMatchObject({ offset: 11, snapshotId: historyUuid(7) })
    await reason('PATIENT_REQUEST')
    expect(container.querySelectorAll('.central-history-card')).toHaveLength(0)
  })

  it('retains void and amendment warnings with source authorship', async () => {
    const h = await mount()
    const response = ready()
    if (!response.ok || response.data.status !== 'READY') throw new Error('Fixture invalid')
    const page = response.data.page
    h.api.read.mockResolvedValueOnce({
      ok: true,
      data: {
        ...response.data,
        page: {
          ...page,
          items: page.items.map((item, index) => ({
            ...item,
            encounter: {
              ...item.encounter,
              status: index === 0 ? 'VOID' : 'AMENDED',
              voidReason: 'Entered twice',
              amendmentReason: 'Corrected observation'
            }
          }))
        }
      }
    })
    await reason()
    await click('View saved history')
    expect(container.textContent).toContain('Voided encounter.')
    expect(container.textContent).toContain('Entered twice')
    expect(container.textContent).toContain('Amended encounter.')
    expect(container.textContent).toContain('Corrected observation')
  })
})
