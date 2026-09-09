import { describe, expect, it, vi } from 'vitest'

import type {
  ActiveLocalSessionContext,
  LocalAuthenticationSessionService
} from '@main/application/authentication/session/local-session-types'
import type {
  ReportDocumentRenderer,
  ReportDocumentService
} from '@main/application/report-documents/report-document-service'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import { createReportDocumentIpcHandlers } from '@main/ipc/handlers/report-document-handlers'
import {
  createIpcSuccess,
  createReportDocumentFailure,
  type ReportDocumentRequest
} from '@shared/ipc'

const request: ReportDocumentRequest = {
  patientId: '11111111-1111-4111-8111-111111111111',
  reportKind: 'REFERRALS',
  suggestedFileName: 'CHS-Referrals-PT-000003.pdf'
}
const frame = { url: 'http://localhost:5173/' }

describe('report document IPC handlers', () => {
  it('passes the authorized renderer and exact validated request to the service', async () => {
    const harness = createHarness()
    await expect(harness.handlers.savePdf(harness.event, request)).resolves.toEqual(
      createIpcSuccess({ status: 'SAVED', fileName: request.suggestedFileName })
    )
    await expect(harness.handlers.print(harness.event, request)).resolves.toEqual(
      createIpcSuccess({ status: 'PRINTED' })
    )
    expect(harness.service.savePdf).toHaveBeenCalledWith(harness.event.sender, request)
    expect(harness.service.print).toHaveBeenCalledWith(harness.event.sender, request)
  })

  it('rejects untrusted senders, locked sessions, and over-posted requests before execution', async () => {
    const harness = createHarness()
    const forbidden = {
      ...harness.event,
      sender: { ...harness.event.sender, mainFrame: { url: 'https://evil.invalid' } },
      senderFrame: { url: 'https://evil.invalid' }
    }
    await expect(harness.handlers.savePdf(forbidden, request)).resolves.toEqual(
      createReportDocumentFailure('IPC_FORBIDDEN')
    )
    await expect(
      harness.handlers.savePdf(harness.event, { ...request, role: 'LOCAL_ADMIN' })
    ).resolves.toEqual(createReportDocumentFailure('VALIDATION_FAILED'))
    vi.mocked(harness.authentication.requireActiveSession).mockImplementation(() => {
      throw new Error('session locked')
    })
    await expect(harness.handlers.print(harness.event, request)).resolves.toMatchObject({
      ok: false
    })
    expect(harness.service.savePdf).not.toHaveBeenCalled()
    expect(harness.service.print).not.toHaveBeenCalled()
  })

  it('contains service exceptions and never logs report names or patient IDs', async () => {
    const harness = createHarness()
    vi.mocked(harness.service.savePdf).mockRejectedValue(
      new Error(`${request.patientId} ${request.suggestedFileName} /private/report.pdf`)
    )
    await expect(harness.handlers.savePdf(harness.event, request)).resolves.toEqual(
      createReportDocumentFailure('INTERNAL_ERROR')
    )
    const logs = harness.logger.error.mock.calls.join('\n')
    expect(logs).not.toContain(request.patientId)
    expect(logs).not.toContain(request.suggestedFileName)
    expect(logs).not.toContain('/private/report.pdf')
    expect(logs).toContain('errorType=Error')
  })
})

function createHarness(): {
  readonly event: ReturnType<typeof createReportDocumentEvent>
  readonly service: ReportDocumentService
  readonly authentication: LocalAuthenticationSessionService
  readonly logger: {
    readonly warn: ReturnType<typeof vi.fn>
    readonly error: ReturnType<typeof vi.fn>
  }
  readonly handlers: ReturnType<typeof createReportDocumentIpcHandlers>
} {
  const renderer: ReportDocumentRenderer = {
    printToPDF: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    print: vi.fn()
  }
  const event = createReportDocumentEvent(renderer)
  const service: ReportDocumentService = {
    savePdf: vi.fn(async () => ({
      status: 'SAVED' as const,
      fileName: request.suggestedFileName
    })),
    print: vi.fn(async () => ({ status: 'PRINTED' as const }))
  }
  const authentication = {
    requireActiveSession: vi.fn(
      () =>
        ({
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'NURSE'
        }) as unknown as ActiveLocalSessionContext
    )
  } as unknown as LocalAuthenticationSessionService
  const logger = { warn: vi.fn(), error: vi.fn() }
  return {
    event,
    service,
    authentication,
    logger,
    handlers: createReportDocumentIpcHandlers({
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: authentication,
      reportDocumentService: service,
      logger
    })
  }
}

function createReportDocumentEvent(renderer: ReportDocumentRenderer): {
  readonly sender: ReportDocumentRenderer & { readonly mainFrame: typeof frame }
  readonly senderFrame: typeof frame
} {
  return { sender: { ...renderer, mainFrame: frame }, senderFrame: frame }
}
