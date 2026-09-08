import { describe, expect, it, vi } from 'vitest'

import type { AuditReportService } from '@main/application'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import { createAuditReportIpcHandlers } from '@main/ipc/handlers/audit-report-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess } from '@shared/ipc'

const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }
const request = {
  query: '',
  occurredFromInclusive: null,
  occurredToExclusive: null,
  actor: { kind: 'ALL' as const },
  action: null,
  entityType: null,
  entityId: null,
  page: 1,
  pageSize: 25 as const
}

describe('audit report IPC handlers', () => {
  it('passes only exact validated requests to the service', async () => {
    const service = createService()
    await expect(createHandlers(service).search(event, request)).resolves.toEqual(
      createIpcSuccess({ status: 'LOADED', items: [], page: 1, pageSize: 25, total: 0 })
    )
    expect(service.search).toHaveBeenCalledWith(request)
  })

  it('rejects over-posted authority before service execution', async () => {
    const service = createService()
    await expect(
      createHandlers(service).search(event, { ...request, role: 'LOCAL_ADMIN' })
    ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(service.search).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders and sanitizes service exceptions', async () => {
    const service = createService()
    vi.mocked(service.getContext).mockImplementation(() => {
      throw new Error('secret database path')
    })
    const handlers = createHandlers(service)
    const forbidden = {
      sender: { mainFrame: { url: 'https://evil.invalid' } },
      senderFrame: { url: 'https://evil.invalid' }
    }

    await expect(handlers.search(forbidden, request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_FORBIDDEN' }
    })
    await expect(handlers.getContext(event, {})).resolves.toEqual(
      createIpcSuccess({ status: 'UNAVAILABLE' })
    )
  })
})

function createHandlers(
  service: AuditReportService
): ReturnType<typeof createAuditReportIpcHandlers> {
  return createAuditReportIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    auditReportService: service,
    logger: { warn: vi.fn(), error: vi.fn() }
  })
}

function createService(): AuditReportService {
  return {
    getContext: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    search: vi.fn(() => ({
      status: 'LOADED' as const,
      items: [],
      page: 1,
      pageSize: 25 as const,
      total: 0
    }))
  }
}
