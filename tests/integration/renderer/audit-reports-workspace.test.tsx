// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type AuditReportApi,
  type ReportDocumentApi,
  type InstallationSettingsErrorCode,
  type PatientErrorCode,
  type PublicAuditReportEvent,
  type ScreeningSessionErrorCode
} from '@shared/ipc'
import { AuditReportsWorkspace } from '../../../src/renderer/src/app/reports/AuditReportsWorkspace'

const deploymentId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const patientId = '33333333-3333-4333-8333-333333333333'
const firstEventId = '44444444-4444-4444-8444-444444444444'
const secondEventId = '55555555-5555-4555-8555-555555555555'

const admin = {
  id: adminId,
  username: 'admin',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN' as const
}
const deployment = {
  id: deploymentId,
  name: 'Cameroon Pilot',
  timeZone: 'Africa/Douala'
}
const events: PublicAuditReportEvent[] = [
  {
    id: firstEventId,
    action: 'PATIENT_UPDATED',
    entityType: 'PATIENT',
    entityId: patientId,
    occurredAt: '2026-09-08T11:00:00.000Z',
    actor: admin,
    deployment,
    metadata: { changed: true, fields: ['phone', 'village'] }
  },
  {
    id: secondEventId,
    action: 'AUTH_LOGIN_FAILED',
    entityType: 'AUTH_SESSION',
    entityId: null,
    occurredAt: '2026-09-08T10:00:00.000Z',
    actor: null,
    deployment,
    metadata: { reason: 'invalid_credentials' }
  }
]

describe('AuditReportsWorkspace', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
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
  })

  it('loads filters and events, selects exact detail, and paginates deterministically', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    expect(harness.getContext).toHaveBeenCalledOnce()
    expect(harness.search).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'ALL' },
        page: 1,
        pageSize: 25,
        occurredFromInclusive: expect.stringMatching(/T23:00:00\.000Z$/u),
        occurredToExclusive: expect.stringMatching(/T23:00:00\.000Z$/u)
      })
    )
    expect(mounted.container.textContent).toContain('60 audit events')
    expect(mounted.container.textContent).toContain('Patient updated')
    expect(mounted.container.textContent).toContain('Admin User')
    expect(mounted.container.querySelector('.audit-report-event-detail')?.textContent).toContain(
      patientId
    )
    expect(
      mounted.container.querySelector('.audit-report-metadata-section')?.textContent
    ).toContain('fields')

    await clickRow(mounted.container, 'Auth login failed')
    expect(mounted.container.querySelector('.audit-report-event-detail')?.textContent).toContain(
      'System'
    )
    expect(
      mounted.container.querySelector('.audit-report-metadata-section')?.textContent
    ).toContain('invalid_credentials')

    await clickButton(mounted.container, 'Next')
    expect(harness.search).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))

    await mounted.unmount()
  })

  it('applies exact audit filters and renders branding only inside print preview', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)

    await changeSelect(mounted.container, 'Actor', `USER:${adminId}`)
    await changeSelect(mounted.container, 'Action', 'PATIENT_UPDATED')
    await changeSelect(mounted.container, 'Entity type', 'PATIENT')
    await changeInput(mounted.container, 'Entity ID', patientId)
    await changeInput(mounted.container, 'Search', 'patient update')
    await changeSelect(mounted.container, 'Rows', '50')
    await clickButton(mounted.container, 'Apply filters')

    expect(harness.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'patient update',
        actor: { kind: 'USER', userId: adminId },
        action: 'PATIENT_UPDATED',
        entityType: 'PATIENT',
        entityId: patientId,
        page: 1,
        pageSize: 50
      })
    )
    expect(
      mounted.container.querySelector('.audit-reports-layout .clinical-report-logo')
    ).toBeNull()

    await clickButton(mounted.container, 'Print preview')
    const dialog = mounted.container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Community Health Screening')
    expect(dialog?.textContent).toContain('Screening guidance is not a diagnosis')
    expect(dialog?.textContent).toContain('Actor: Admin User')
    expect(dialog?.textContent).toContain('Reported by Admin User')
    expect(dialog?.querySelector('.audit-pdf-logo')).not.toBeNull()

    const previousTitle = document.title
    await clickButton(dialog!, 'Print')
    expect(harness.documentApi.print).toHaveBeenCalledWith({
      reportKind: 'AUDIT',
      suggestedFileName: expect.stringMatching(/^CHS-audit-report-.*-page-1\.pdf$/u)
    })
    await clickButton(dialog!, 'Save PDF')
    expect(harness.documentApi.savePdf).toHaveBeenCalledWith({
      reportKind: 'AUDIT',
      suggestedFileName: expect.stringMatching(/^CHS-audit-report-.*-page-1\.pdf$/u)
    })
    expect(dialog?.textContent).toContain('Current filtered results page only')
    expect(dialog?.textContent).toContain('Showing 1-2 of 60 matching events; result page 1 of 2.')
    const trigger = Array.from(mounted.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print preview'
    )
    // Real clicks focus the trigger; capture it explicitly in jsdom for the next preview.
    await clickButton(dialog!, 'Close')
    trigger?.focus()
    await clickButton(mounted.container, 'Print preview')
    await clickButton(mounted.container.querySelector('dialog')!, 'Close')
    expect(document.activeElement).toBe(trigger)
    expect(document.adoptedStyleSheets).toHaveLength(0)
    expect(document.title).toBe(previousTitle)

    await mounted.unmount()
  })

  it('exports only the loaded page with applied filters, without fetching or using draft edits', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)
    await clickButton(mounted.container, 'Next')
    await changeInput(mounted.container, 'Search', 'unapplied search')
    const calls = harness.search.mock.calls.length
    await clickButton(mounted.container, 'Print preview')
    const dialog = mounted.container.querySelector('dialog')!
    expect(dialog.textContent).toContain('Showing 26-27 of 60 matching events; result page 2 of 3.')
    expect(dialog.textContent).not.toContain('unapplied search')
    const copy = mounted.container.querySelector('.audit-pdf-print-copy')!
    expect(copy.textContent).toContain('invalid_credentials')
    expect(copy.querySelectorAll('.audit-pdf-event')).toHaveLength(2)
    await clickButton(dialog, 'Save PDF')
    expect(harness.documentApi.savePdf).toHaveBeenCalledWith({
      reportKind: 'AUDIT',
      suggestedFileName: expect.stringMatching(/-page-2\.pdf$/u)
    })
    expect(harness.search).toHaveBeenCalledTimes(calls)
    await mounted.unmount()
  })

  it('refreshes event options and the applied page while keeping unapplied filter edits', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)
    await changeInput(mounted.container, 'Search', 'user')
    await clickButton(mounted.container, 'Apply filters')
    await clickButton(mounted.container, 'Next')
    await changeInput(mounted.container, 'Search', 'unapplied draft')
    harness.getContext.mockResolvedValue(
      createIpcSuccess({
        status: 'LOADED',
        deployment,
        actors: [admin],
        actions: ['USER_ADMIN_UPDATE'],
        entityTypes: ['USER'],
        hasSystemEvents: true
      })
    )
    harness.search.mockResolvedValue(
      createIpcSuccess({
        status: 'LOADED',
        items: [
          {
            ...events[0]!,
            action: 'USER_ADMIN_UPDATE',
            entityType: 'USER',
            metadata: { reason: 'Staff moved', is_active: false }
          }
        ],
        page: 2,
        pageSize: 25,
        total: 60
      })
    )
    await clickButton(mounted.container, 'Refresh')
    expect(harness.getContext).toHaveBeenCalledTimes(2)
    expect(harness.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'user', page: 2 })
    )
    expect(labeledControl<HTMLInputElement>(mounted.container, 'Search', 'input').value).toBe(
      'unapplied draft'
    )
    expect(
      labeledControl<HTMLSelectElement>(mounted.container, 'Action', 'select').textContent
    ).toContain('User admin update')
    expect(mounted.container.querySelector('.audit-report-event-detail')?.textContent).toContain(
      'Staff moved'
    )
    expect(mounted.container.querySelector('.audit-report-event-detail')?.textContent).toContain(
      'false'
    )
    await mounted.unmount()
  })

  it('recovers an initial context failure through Retry without leaving the workspace', async () => {
    const harness = createHarness()
    harness.getContext.mockResolvedValueOnce(createIpcSuccess({ status: 'UNAVAILABLE' }))
    const mounted = await mount(harness)
    expect(harness.search).not.toHaveBeenCalled()
    expect(mounted.container.textContent).toContain('Audit report filters could not be loaded')
    await clickButton(mounted.container, 'Retry loading audit')
    expect(harness.getContext).toHaveBeenCalledTimes(2)
    expect(harness.search).toHaveBeenCalledOnce()
    expect(mounted.container.textContent).toContain('60 audit events')
    await mounted.unmount()
  })

  it('removes stale results and print preview when a new query fails, then supports retry', async () => {
    const harness = createHarness()
    const mounted = await mount(harness)
    await clickButton(mounted.container, 'Print preview')
    expect(mounted.container.querySelector('[role="dialog"]')).not.toBeNull()
    await clickButton(mounted.container, 'Close')
    harness.search.mockResolvedValueOnce(createIpcSuccess({ status: 'UNAVAILABLE' }))
    await changeInput(mounted.container, 'Search', 'different results')
    await clickButton(mounted.container, 'Apply filters')
    expect(mounted.container.querySelector('.audit-report-event-detail')).toBeNull()
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull()
    expect(mounted.container.querySelectorAll('tbody tr')).toHaveLength(0)
    expect(mounted.container.textContent).not.toContain('Print preview')
    await clickButton(mounted.container, 'Retry')
    expect(harness.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: 'different results', page: 1 })
    )
    expect(mounted.container.querySelector('.audit-report-event-detail')).not.toBeNull()
    await mounted.unmount()
  })

  it('routes controlled authorization failures without reading audit events', async () => {
    const onAuthenticationFailure = vi.fn()
    const api: AuditReportApi = {
      getContext: vi.fn(() => Promise.resolve(createIpcSuccess({ status: 'FORBIDDEN' as const }))),
      search: vi.fn()
    }
    const mounted = await mount({ api, onAuthenticationFailure })

    expect(onAuthenticationFailure).toHaveBeenCalledWith('AUTHORIZATION_FAILED')
    expect(api.search).not.toHaveBeenCalled()

    await mounted.unmount()
  })
})

interface Harness {
  readonly documentApi: ReportDocumentApi
  readonly api: AuditReportApi
  readonly getContext: ReturnType<typeof vi.fn<AuditReportApi['getContext']>>
  readonly search: ReturnType<typeof vi.fn<AuditReportApi['search']>>
  readonly onAuthenticationFailure: ReturnType<typeof vi.fn<AuditAuthenticationFailure>>
}

type AuditAuthenticationFailure = (
  code: PatientErrorCode | ScreeningSessionErrorCode | InstallationSettingsErrorCode
) => void

function createHarness(): Harness {
  const getContext = vi.fn<AuditReportApi['getContext']>(() =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        deployment,
        actors: [admin],
        actions: ['AUTH_LOGIN_FAILED', 'PATIENT_UPDATED'],
        entityTypes: ['AUTH_SESSION', 'PATIENT'],
        hasSystemEvents: true
      })
    )
  )
  const search = vi.fn<AuditReportApi['search']>((request) =>
    Promise.resolve(
      createIpcSuccess({
        status: 'LOADED',
        items: events,
        page: request.page,
        pageSize: request.pageSize,
        total: 60
      })
    )
  )
  return {
    api: { getContext, search },
    documentApi: {
      savePdf: vi.fn(async () =>
        createIpcSuccess({ status: 'SAVED' as const, fileName: 'audit.pdf' })
      ),
      print: vi.fn(async () => createIpcSuccess({ status: 'PRINTED' as const }))
    },
    getContext,
    search,
    onAuthenticationFailure: vi.fn<AuditAuthenticationFailure>()
  }
}

async function mount(
  harness: Pick<Harness, 'api' | 'onAuthenticationFailure'> & Partial<Pick<Harness, 'documentApi'>>
): Promise<{
  readonly container: HTMLElement
  unmount(): Promise<void>
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(AuditReportsWorkspace, {
        api: harness.api,
        documentApi: harness.documentApi,
        timeZone: 'Africa/Douala',
        reportedBy: 'Admin User',
        headingId: 'audit-report-heading',
        headingRef: { current: null },
        onAuthenticationFailure: harness.onAuthenticationFailure
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
      container.remove()
    }
  }
}

async function changeSelect(container: Element, label: string, value: string): Promise<void> {
  const select = labeledControl<HTMLSelectElement>(container, label, 'select')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
  })
}

async function changeInput(container: Element, label: string, value: string): Promise<void> {
  const input = labeledControl<HTMLInputElement>(container, label, 'input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  })
}

function labeledControl<TElement extends HTMLElement>(
  container: Element,
  label: string,
  selector: string
): TElement {
  const control = Array.from(container.querySelectorAll('label'))
    .find((item) => item.textContent?.includes(label))
    ?.querySelector<TElement>(selector)
  if (control === undefined || control === null) throw new Error(`Missing control: ${label}`)
  return control
}

async function clickRow(container: Element, text: string): Promise<void> {
  const row = Array.from(container.querySelectorAll('tbody tr')).find((item) =>
    item.textContent?.includes(text)
  )
  if (!(row instanceof HTMLElement)) throw new Error(`Missing row: ${text}`)
  await act(async () => {
    row.click()
    await flush()
  })
}

async function clickButton(container: Element, text: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === text
  )
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${text}`)
  await act(async () => {
    button.click()
    await flush()
  })
  await act(flush)
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
