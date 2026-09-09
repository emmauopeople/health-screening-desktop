import { describe, expect, it, vi } from 'vitest'

import {
  createReportDocumentService,
  type ReportDocumentRenderer,
  type ReportDocumentSaveDialogResult
} from '@main/application/report-documents/report-document-service'
import type { ReportDocumentRequest } from '@shared/ipc'

const request: ReportDocumentRequest = {
  patientId: '11111111-1111-4111-8111-111111111111',
  reportKind: 'GENERAL',
  suggestedFileName: 'CHS-General-PT-000003.pdf'
}

describe('report document service', () => {
  it('cancels without rendering or writing when the save dialog is dismissed', async () => {
    const harness = createHarness({ canceled: true })
    await expect(harness.service.savePdf(harness.renderer, request)).resolves.toEqual({
      status: 'CANCELLED'
    })
    expect(harness.printToPDF).not.toHaveBeenCalled()
    expect(harness.writeFile).not.toHaveBeenCalled()
  })

  it('creates an A4 vector PDF, writes the selected destination, and returns only its basename', async () => {
    const harness = createHarness({ canceled: false, filePath: '/private/reports/Suzana report' })
    await expect(harness.service.savePdf(harness.renderer, request)).resolves.toEqual({
      status: 'SAVED',
      fileName: 'Suzana report.pdf'
    })
    expect(harness.showSaveDialog).toHaveBeenCalledWith({
      title: 'Save patient report PDF',
      defaultPath: request.suggestedFileName,
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    expect(harness.printToPDF).toHaveBeenCalledWith({
      pageSize: 'A4',
      preferCSSPageSize: true,
      printBackground: true
    })
    expect(harness.writeFile).toHaveBeenCalledWith(
      '/private/reports/Suzana report.pdf',
      new Uint8Array([37, 80, 68, 70])
    )
  })

  it('does not write an empty PDF and maps print completion, cancellation, and failure', async () => {
    const empty = createHarness(
      { canceled: false, filePath: '/reports/empty.pdf' },
      new Uint8Array()
    )
    await expect(empty.service.savePdf(empty.renderer, request)).resolves.toEqual({
      status: 'UNAVAILABLE'
    })
    expect(empty.writeFile).not.toHaveBeenCalled()

    for (const [success, reason, status] of [
      [true, '', 'PRINTED'],
      [false, 'Print job cancelled', 'CANCELLED'],
      [false, 'Printer unavailable', 'UNAVAILABLE']
    ] as const) {
      const harness = createHarness({ canceled: true }, undefined, { success, reason })
      await expect(harness.service.print(harness.renderer, request)).resolves.toEqual({ status })
      expect(harness.print).toHaveBeenCalledWith(
        { silent: false, printBackground: true },
        expect.any(Function)
      )
    }
  })
})

function createHarness(
  dialogResult: ReportDocumentSaveDialogResult,
  pdf = new Uint8Array([37, 80, 68, 70]),
  printResult = { success: true, reason: '' }
): {
  readonly showSaveDialog: ReturnType<typeof vi.fn>
  readonly writeFile: ReturnType<typeof vi.fn>
  readonly printToPDF: ReturnType<typeof vi.fn>
  readonly print: ReturnType<typeof vi.fn<ReportDocumentRenderer['print']>>
  readonly renderer: ReportDocumentRenderer
  readonly service: ReturnType<typeof createReportDocumentService>
} {
  const showSaveDialog = vi.fn(async () => dialogResult)
  const writeFile = vi.fn(async () => undefined)
  const printToPDF = vi.fn(async () => pdf)
  const print = vi.fn<ReportDocumentRenderer['print']>((_options, callback) =>
    callback(printResult.success, printResult.reason)
  )
  return {
    showSaveDialog,
    writeFile,
    printToPDF,
    print,
    renderer: { printToPDF, print },
    service: createReportDocumentService({ showSaveDialog, writeFile })
  }
}
