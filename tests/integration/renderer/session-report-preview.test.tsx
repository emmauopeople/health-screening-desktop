// @vitest-environment jsdom
/// <reference lib="dom" />
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIpcSuccess,
  createReportDocumentFailure,
  type ReportDocumentActionResult,
  type ReportDocumentApi,
  type PublicScreeningSessionSummary
} from '@shared/ipc'
import { SessionReportPreview } from '../../../src/renderer/src/app/reports/SessionReportPreview'

const summary: PublicScreeningSessionSummary = {
  id: '99999999-9999-4999-8999-999999999999',
  sessionDate: '2026-09-17',
  status: 'OPEN',
  location: { id: '77777777-7777-4777-8777-777777777777', name: 'Babungo' },
  openedAt: '2026-09-17T08:00:00.000Z',
  openedBy: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Nurse One' },
  closedAt: null,
  closedBy: null,
  operational: {
    totalEncounters: 5,
    activeDrafts: 1,
    emptyDrafts: 1,
    finalizedEncounters: 2,
    voidedEncounters: 1
  },
  recommendations: { routine: 1, standardReferral: 0, urgentReferral: 1 },
  referrals: { open: 1, closed: 0 }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(document, 'adoptedStyleSheets', {
    configurable: true,
    writable: true,
    value: []
  })
  Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', {
    configurable: true,
    value: vi.fn()
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('session report preview', () => {
  it('uses a static readable report with separate draft/void totals and no record IDs or clinical actions', async () => {
    const h = await mount()
    const article = h.container.querySelector('article')!
    expect(article.textContent).toContain('17 Sept 2026')
    expect(article.textContent).toContain('Babungo')
    expect(article.textContent).toContain('Not closed')
    expect(article.textContent).toContain('Reported by: Nurse Two')
    expect(article.textContent).toContain('Active drafts1')
    expect(article.textContent).toContain('Empty drafts1')
    expect(article.textContent).toContain('Voided encounters1')
    expect(article.textContent).not.toContain(summary.id)
    expect(article.querySelectorAll('button, a, input, svg')).toHaveLength(0)
    expect(article.querySelectorAll('thead')).toHaveLength(3)
    expect(document.activeElement?.textContent).toContain('Save PDF')
    await h.unmount()
  })

  it('keeps the preview open during export and allows closing after cancellation', async () => {
    let resolve!: (result: ReportDocumentActionResult) => void
    const savePdf = vi.fn(
      () =>
        new Promise<ReportDocumentActionResult>((done) => {
          resolve = done
        })
    )
    const h = await mount(savePdf)
    await h.click('Save PDF')
    expect(h.button('Close').disabled).toBe(true)
    expect(h.button('Print').disabled).toBe(true)
    await act(async () => {
      h.container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }))
    })
    expect(h.onClose).not.toHaveBeenCalled()
    await act(async () => {
      resolve(createIpcSuccess({ status: 'CANCELLED' }))
    })
    expect(h.container.textContent).toContain('PDF save cancelled.')
    expect(h.button('Close').disabled).toBe(false)
    await act(async () => {
      h.container.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }))
    })
    expect(h.onClose).toHaveBeenCalledOnce()
    await h.unmount()
  })

  it('contains a failed save, restores the document title and allows retry', async () => {
    const savePdf = vi
      .fn<ReportDocumentApi['savePdf']>()
      .mockRejectedValueOnce(new Error('private path'))
      .mockResolvedValue(createIpcSuccess({ status: 'SAVED', fileName: 'session.pdf' }))
    const h = await mount(savePdf)
    const title = document.title
    await h.click('Save PDF')
    expect(document.title).toBe(title)
    expect(h.container.textContent).toContain('The report document service is unavailable.')
    expect(h.container.textContent).not.toContain('private path')
    await h.click('Save PDF')
    expect(h.container.textContent).toContain('PDF saved as session.pdf.')
    await h.unmount()
  })

  it('routes export authorization failure back to the shell', async () => {
    const h = await mount(vi.fn(async () => createReportDocumentFailure('AUTH_LOCKED')))
    await h.click('Save PDF')
    expect(h.onAuthenticationFailure).toHaveBeenCalledWith('AUTH_LOCKED')
    await h.unmount()
  })
})

async function mount(
  savePdf: ReportDocumentApi['savePdf'] = vi.fn(async () =>
    createIpcSuccess({ status: 'SAVED' as const, fileName: 'session.pdf' })
  )
): Promise<{
  container: HTMLDivElement
  button(label: string): HTMLButtonElement
  onClose: ReturnType<typeof vi.fn>
  onAuthenticationFailure: ReturnType<typeof vi.fn>
  click(label: string): Promise<void>
  unmount(): Promise<void>
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onClose = vi.fn()
  const onAuthenticationFailure = vi.fn()
  await act(async () => {
    root.render(
      createElement(SessionReportPreview, {
        summary,
        generatedAt: '2026-09-17T09:00:00.000Z',
        timeZone: 'Africa/Douala',
        reportedBy: 'Nurse Two',
        api: {
          savePdf,
          print: vi.fn(async () => createIpcSuccess({ status: 'PRINTED' as const }))
        },
        onClose,
        onAuthenticationFailure
      })
    )
  })
  function button(label: string): HTMLButtonElement {
    const result = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label
    )
    if (!result) throw new Error(`Missing ${label}`)
    return result
  }
  return {
    container,
    button,
    onClose,
    onAuthenticationFailure,
    async click(label: string) {
      await act(async () => {
        button(label).click()
      })
    },
    async unmount() {
      await act(async () => root.unmount())
    }
  }
}
