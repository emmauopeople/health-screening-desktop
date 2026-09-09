import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'

import { createReportDocumentService, type ReportDocumentService } from './report-document-service'

export function createElectronReportDocumentService(): ReportDocumentService {
  return createReportDocumentService({
    showSaveDialog: (options) =>
      dialog.showSaveDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters.map((filter) => ({
          name: filter.name,
          extensions: [...filter.extensions]
        })),
        properties: [...options.properties]
      }),
    writeFile
  })
}
