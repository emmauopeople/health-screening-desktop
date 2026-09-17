import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  createReportDocumentFailure,
  reportDocumentActionResultSchema,
  reportDocumentRequestSchema
} from '@shared/ipc'

const request = {
  patientId: '11111111-1111-4111-8111-111111111111',
  reportKind: 'GENERAL' as const,
  suggestedFileName: 'CHS-General-PT-000003-2026-08-06-to-2026-09-04.pdf'
}

describe('report document contracts', () => {
  it('accepts exact patient report requests and every bounded result state', () => {
    expect(reportDocumentRequestSchema.parse(request)).toEqual(request)
    expect(
      reportDocumentActionResultSchema.parse(
        createIpcSuccess({ status: 'SAVED', fileName: 'Suzana report.pdf' })
      )
    ).toEqual(createIpcSuccess({ status: 'SAVED', fileName: 'Suzana report.pdf' }))
    expect(
      reportDocumentActionResultSchema.safeParse(createIpcSuccess({ status: 'PRINTED' })).success
    ).toBe(true)
    expect(
      reportDocumentActionResultSchema.safeParse(createIpcSuccess({ status: 'CANCELLED' })).success
    ).toBe(true)
    expect(
      reportDocumentActionResultSchema.safeParse(createIpcSuccess({ status: 'UNAVAILABLE' }))
        .success
    ).toBe(true)
    expect(
      reportDocumentActionResultSchema.parse(createReportDocumentFailure('IPC_UNAVAILABLE'))
    ).toEqual(createReportDocumentFailure('IPC_UNAVAILABLE'))
  })

  it('rejects path traversal, non-PDF names, malformed IDs, and authority over-posting', () => {
    expect(
      reportDocumentRequestSchema.safeParse({ ...request, suggestedFileName: '../report.pdf' })
        .success
    ).toBe(false)
    expect(
      reportDocumentRequestSchema.safeParse({ ...request, suggestedFileName: 'report.html' })
        .success
    ).toBe(false)
    expect(
      reportDocumentRequestSchema.safeParse({ ...request, patientId: 'PT-000003' }).success
    ).toBe(false)
    expect(reportDocumentRequestSchema.safeParse({ ...request, role: 'LOCAL_ADMIN' }).success).toBe(
      false
    )
  })

  it('accepts session IDs only for session reports and rejects mixed scopes', () => {
    const session = {
      reportKind: 'SESSION',
      sessionId: request.patientId,
      suggestedFileName: 'CHS-session-report-2026-09-17.pdf'
    }
    expect(reportDocumentRequestSchema.parse(session)).toEqual(session)
    for (const invalid of [
      { ...session, patientId: request.patientId },
      { ...session, sessionId: 'not-a-uuid' },
      { ...session, reportKind: 'GENERAL' },
      { ...request, reportKind: 'SESSION' },
      { ...session, suggestedFileName: '../report.pdf' },
      { ...session, role: 'LOCAL_ADMIN' }
    ])
      expect(reportDocumentRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it('accepts audit exports without fake clinical IDs and rejects mixed scopes and paths', () => {
    const audit = { reportKind: 'AUDIT', suggestedFileName: 'CHS-audit-report-page-2.pdf' }
    expect(reportDocumentRequestSchema.parse(audit)).toEqual(audit)
    for (const invalid of [
      { ...audit, patientId: request.patientId },
      { ...audit, sessionId: request.patientId },
      { ...audit, role: 'LOCAL_ADMIN' },
      { ...audit, suggestedFileName: '../audit.pdf' },
      { ...audit, suggestedFileName: 'audit.html' }
    ])
      expect(reportDocumentRequestSchema.safeParse(invalid).success).toBe(false)
  })

  it('fails closed when parsing hostile getters', () => {
    const hostile = Object.create(null) as Record<string, unknown>
    Object.defineProperty(hostile, 'reportKind', {
      enumerable: true,
      get() {
        throw new Error('private report value')
      }
    })
    expect(() => reportDocumentRequestSchema.safeParse(hostile)).toThrow('private report value')
  })
})
