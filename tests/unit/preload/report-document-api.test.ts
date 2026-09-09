import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import {
  createIpcSuccess,
  createReportDocumentFailure,
  ipcChannels,
  type ReportDocumentRequest
} from '@shared/ipc'

const request: ReportDocumentRequest = {
  patientId: '11111111-1111-4111-8111-111111111111',
  reportKind: 'VITALS',
  suggestedFileName: 'CHS-Vitals-PT-000003.pdf'
}

describe('preload report document API', () => {
  it('exposes two frozen methods without a transport escape hatch', () => {
    const api = createHealthScreeningApi(vi.fn()).reportDocuments
    expect(Object.keys(api)).toEqual(['savePdf', 'print'])
    expect(Object.isFrozen(api)).toBe(true)
    expect('invoke' in api).toBe(false)
    expect('channel' in api).toBe(false)
  })

  it('uses fixed channels and exact validated requests', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'SAVED', fileName: request.suggestedFileName })
      )
      .mockResolvedValueOnce(createIpcSuccess({ status: 'PRINTED' }))
    const api = createHealthScreeningApi(invoke).reportDocuments

    await expect(api.savePdf(request)).resolves.toEqual(
      createIpcSuccess({ status: 'SAVED', fileName: request.suggestedFileName })
    )
    await expect(api.print(request)).resolves.toEqual(createIpcSuccess({ status: 'PRINTED' }))
    expect(invoke).toHaveBeenNthCalledWith(1, ipcChannels.reportDocuments.savePdf, request)
    expect(invoke).toHaveBeenNthCalledWith(2, ipcChannels.reportDocuments.print, request)
  })

  it('blocks malformed requests and contains rejected or malformed responses', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke).reportDocuments
    await expect(api.savePdf({ ...request, suggestedFileName: '../private.pdf' })).resolves.toEqual(
      createReportDocumentFailure('VALIDATION_FAILED')
    )
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValueOnce({
      ok: true,
      data: { status: 'SAVED', filePath: '/private/a.pdf' }
    })
    await expect(api.savePdf(request)).resolves.toEqual(
      createReportDocumentFailure('IPC_UNAVAILABLE')
    )
    invoke.mockRejectedValueOnce(new Error('transport unavailable'))
    await expect(api.print(request)).resolves.toEqual(
      createReportDocumentFailure('IPC_UNAVAILABLE')
    )
  })
})
