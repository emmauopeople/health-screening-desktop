import { useEffect, useRef, useState } from 'react'
import type { ReportDocumentApi, ScreeningSessionErrorCode } from '@shared/ipc'
import { ReportDocumentActions } from './ReportDocumentActions'
import { AuditReportDocument, type AuditReportDocumentProps } from './AuditReportDocument'
import { createAuditReportPageStyle } from './audit-report-page-style'
import './audit-report-pdf.css'

interface AuditReportPreviewProps extends AuditReportDocumentProps {
  readonly api: ReportDocumentApi | undefined
  onClose(): void
  onAuthenticationFailure(code: ScreeningSessionErrorCode): void
}

export function AuditReportPreview({
  api,
  onClose,
  onAuthenticationFailure,
  ...documentProps
}: AuditReportPreviewProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const pageStyle = new CSSStyleSheet()
    pageStyle.replaceSync(
      createAuditReportPageStyle(documentProps.context.deployment.name, documentProps.reportedBy)
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle]
    const dialog = dialogRef.current
    dialog?.showModal()
    ;(saveRef.current ?? closeRef.current)?.focus()
    return () => {
      dialog?.close()
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== pageStyle
      )
    }
  }, [documentProps.context.deployment.name, documentProps.reportedBy])
  return (
    <>
      <dialog
        ref={dialogRef}
        role="dialog"
        className="audit-pdf-preview"
        aria-label="Audit report print preview"
        onCancel={(event) => {
          event.preventDefault()
          if (!busyRef.current) onClose()
        }}
      >
        <header className="audit-pdf-toolbar">
          <div>
            <strong>Audit report print preview</strong>
            <p>{`Current filtered page - ${documentProps.page.items.length} events`}</p>
          </div>
          {api === undefined ? (
            <p role="status">The report document service is unavailable.</p>
          ) : (
            <ReportDocumentActions
              api={api}
              request={{
                reportKind: 'AUDIT',
                suggestedFileName: `CHS-audit-report-${documentProps.generatedAt.slice(0, 10)}-page-${documentProps.page.page}.pdf`
              }}
              primaryButtonRef={saveRef}
              onAuthenticationFailure={onAuthenticationFailure}
              onBusyChange={(value) => {
                busyRef.current = value
                setBusy(value)
              }}
            />
          )}
          <button
            ref={closeRef}
            className="button button-secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="audit-pdf-scroll">
          <AuditReportDocument {...documentProps} />
        </div>
      </dialog>
      <div className="audit-pdf-print-copy" aria-hidden="true">
        <AuditReportDocument {...documentProps} />
      </div>
    </>
  )
}
