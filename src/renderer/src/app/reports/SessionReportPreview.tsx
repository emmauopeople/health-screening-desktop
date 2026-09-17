import { useEffect, useRef, useState } from 'react'
import type { ReportDocumentApi, ScreeningSessionErrorCode } from '@shared/ipc'
import { ReportDocumentActions } from './ReportDocumentActions'
import { SessionReportDocument, type SessionReportDocumentProps } from './SessionReportDocument'
import { createSessionReportPageStyle } from './session-report-page-style'
import './session-report-pdf.css'

interface SessionReportPreviewProps extends SessionReportDocumentProps {
  readonly api: ReportDocumentApi
  onClose(): void
  onAuthenticationFailure(code: ScreeningSessionErrorCode): void
}

export function SessionReportPreview({
  api,
  onClose,
  onAuthenticationFailure,
  ...documentProps
}: SessionReportPreviewProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const saveRef = useRef<HTMLButtonElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const pageStyle = new CSSStyleSheet()
    pageStyle.replaceSync(
      createSessionReportPageStyle(documentProps.summary.sessionDate, documentProps.reportedBy)
    )
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyle]
    const dialog = dialogRef.current
    dialog?.showModal()
    saveRef.current?.focus()
    return () => {
      dialog?.close()
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        (sheet) => sheet !== pageStyle
      )
    }
  }, [documentProps.summary.sessionDate, documentProps.reportedBy])

  return (
    <>
      <dialog
        ref={dialogRef}
        className="session-pdf-preview"
        aria-label="Session report print preview"
        onCancel={(event) => {
          event.preventDefault()
          if (!busyRef.current) onClose()
        }}
      >
        <header className="session-pdf-toolbar">
          <div>
            <strong>Print preview</strong>
            <p>Selected session: {documentProps.summary.sessionDate}</p>
          </div>
          <ReportDocumentActions
            api={api}
            request={{
              reportKind: 'SESSION',
              sessionId: documentProps.summary.id,
              suggestedFileName: `CHS-session-report-${documentProps.summary.sessionDate}.pdf`
            }}
            primaryButtonRef={saveRef}
            onAuthenticationFailure={onAuthenticationFailure}
            onBusyChange={(value) => {
              busyRef.current = value
              setBusy(value)
            }}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="session-pdf-scroll">
          <SessionReportDocument {...documentProps} />
        </div>
      </dialog>
      <div className="session-pdf-print-copy" aria-hidden="true">
        <SessionReportDocument {...documentProps} />
      </div>
    </>
  )
}
