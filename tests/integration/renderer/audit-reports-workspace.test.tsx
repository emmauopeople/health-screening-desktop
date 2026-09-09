// @vitest-environment jsdom
/// <reference lib="dom" />

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  type AuditReportApi,
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
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined)
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
    expect(dialog?.querySelector('.clinical-report-logo')).not.toBeNull()

    const previousTitle = document.title
    await clickButton(dialog!, 'Print')
    expect(printSpy).toHaveBeenCalledOnce()
    expect(document.title).toBe(previousTitle)

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
    getContext,
    search,
    onAuthenticationFailure: vi.fn<AuditAuthenticationFailure>()
  }
}

async function mount(harness: Pick<Harness, 'api' | 'onAuthenticationFailure'>): Promise<{
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
