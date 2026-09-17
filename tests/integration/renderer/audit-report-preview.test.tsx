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
  type PublicAuditReportEvent
} from '@shared/ipc'
import { AuditReportPreview } from '../../../src/renderer/src/app/reports/AuditReportPreview'

import {
  applyAuditReportFilters,
  createInitialAuditReportFilters
} from '../../../src/renderer/src/app/reports/audit-report-model'
const deployment = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Babungo',
  timeZone: 'Africa/Douala'
}
const event: PublicAuditReportEvent = {
  id: '99999999-9999-4999-8999-999999999999',
  action: 'PATIENT_UPDATED',
  entityType: 'PATIENT',
  entityId: '11111111-1111-4111-8111-111111111111',
  occurredAt: '2026-09-17T08:00:00.000Z',
  actor: null,
  deployment,
  metadata: { fields: ['phone', 'village'], changed: true }
}
const filters = applyAuditReportFilters(
  createInitialAuditReportFilters('Africa/Douala', new Date('2026-09-17T09:00:00Z')),
  'Africa/Douala'
)!

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

describe('audit report preview', () => {
  it('includes the exact current page and metadata without interactive controls in the document', async () => {
    const h = await mount()
    const article = h.container.querySelector('article')!
    expect(article.textContent).toContain('Babungo')
    expect(article.textContent).toContain(
      'Showing 26-26 of 60 matching events; result page 2 of 3.'
    )
    expect(article.textContent).toContain('Current filtered results page only')
    expect(article.textContent).toContain('System')
    expect(article.textContent).toContain('Patient updated')
    expect(article.textContent).toContain(event.entityId)
    expect(article.textContent).toContain('"village"')
    expect(article.querySelectorAll('button, a, input, svg')).toHaveLength(0)
    expect(h.container.querySelector('.audit-pdf-print-copy article')?.innerHTML).toBe(
      article.innerHTML
    )
    expect(document.activeElement?.textContent).toContain('Save PDF')
    await h.unmount()
    expect(document.adoptedStyleSheets).toHaveLength(0)
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
      .mockResolvedValue(createIpcSuccess({ status: 'SAVED', fileName: 'audit.pdf' }))
    const h = await mount(savePdf)
    const title = document.title
    await h.click('Save PDF')
    expect(document.title).toBe(title)
    expect(h.container.textContent).toContain('The report document service is unavailable.')
    expect(h.container.textContent).not.toContain('private path')
    await h.click('Save PDF')
    expect(h.container.textContent).toContain('PDF saved as audit.pdf.')
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
    createIpcSuccess({ status: 'SAVED' as const, fileName: 'audit.pdf' })
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
      createElement(AuditReportPreview, {
        page: { items: [event], page: 2, pageSize: 25, total: 60 },
        context: { deployment, actors: [] },
        filters,
        generatedAt: '2026-09-17T09:00:00.000Z',
        timeZone: 'Africa/Douala',
        reportedBy: 'Admin User',
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
