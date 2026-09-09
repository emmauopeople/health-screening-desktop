import { basename } from 'node:path'

import type {
  ReportDocumentActionData,
  ReportDocumentRequest
} from '@shared/ipc/report-document-contracts'

export interface ReportDocumentRenderer {
  printToPDF(options: {
    readonly pageSize: 'A4'
    readonly preferCSSPageSize: true
    readonly printBackground: true
  }): Promise<Uint8Array>
  print(
    options: { readonly silent: false; readonly printBackground: true },
    callback: (success: boolean, failureReason: string) => void
  ): void
}

export interface ReportDocumentSaveDialogResult {
  readonly canceled: boolean
  readonly filePath?: string
}

export interface ReportDocumentServiceDependencies {
  showSaveDialog(options: {
    readonly title: string
    readonly defaultPath: string
    readonly filters: readonly { readonly name: string; readonly extensions: readonly string[] }[]
    readonly properties: readonly ('createDirectory' | 'showOverwriteConfirmation')[]
  }): Promise<ReportDocumentSaveDialogResult>
  writeFile(path: string, data: Uint8Array): Promise<void>
}

export interface ReportDocumentService {
  savePdf(
    renderer: ReportDocumentRenderer,
    request: ReportDocumentRequest
  ): Promise<ReportDocumentActionData>
  print(
    renderer: ReportDocumentRenderer,
    request: ReportDocumentRequest
  ): Promise<ReportDocumentActionData>
}

export function createReportDocumentService({
  showSaveDialog,
  writeFile
}: ReportDocumentServiceDependencies): ReportDocumentService {
  return Object.freeze({
    async savePdf(renderer: ReportDocumentRenderer, request: ReportDocumentRequest) {
      const destination = await showSaveDialog({
        title: 'Save patient report PDF',
        defaultPath: request.suggestedFileName,
        filters: [{ name: 'PDF document', extensions: ['pdf'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (destination.canceled || destination.filePath === undefined) {
        return Object.freeze({ status: 'CANCELLED' as const })
      }

      const filePath = ensurePdfExtension(destination.filePath)
      const pdf = await renderer.printToPDF({
        pageSize: 'A4',
        preferCSSPageSize: true,
        printBackground: true
      })
      if (pdf.byteLength === 0) return Object.freeze({ status: 'UNAVAILABLE' as const })

      await writeFile(filePath, pdf)
      return Object.freeze({
        status: 'SAVED' as const,
        fileName: basename(filePath)
      })
    },

    async print(renderer: ReportDocumentRenderer) {
      return new Promise<ReportDocumentActionData>((resolve) => {
        renderer.print(
          { silent: false, printBackground: true },
          (success: boolean, failureReason: string) => {
            if (success) {
              resolve(Object.freeze({ status: 'PRINTED' as const }))
              return
            }
            resolve(
              Object.freeze({
                status: isPrintCancellation(failureReason) ? ('CANCELLED' as const) : 'UNAVAILABLE'
              })
            )
          }
        )
      })
    }
  })
}

function isPrintCancellation(value: string): boolean {
  return value.toLowerCase().includes('cancel')
}

function ensurePdfExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.pdf') ? filePath : `${filePath}.pdf`
}
