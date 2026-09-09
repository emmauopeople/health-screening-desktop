import { useState, type RefObject } from 'react'
import type { ReportDocumentApi, ReportDocumentErrorCode, ReportDocumentRequest } from '@shared/ipc'

type ReportDocumentAuthenticationCode = Extract<
  ReportDocumentErrorCode,
  | 'IPC_FORBIDDEN'
  | 'AUTH_UNAUTHENTICATED'
  | 'AUTH_LOCKED'
  | 'AUTH_PASSWORD_CHANGE_REQUIRED'
  | 'AUTHORIZATION_FAILED'
>

interface ReportDocumentActionsProps {
  readonly api: ReportDocumentApi
  readonly request: ReportDocumentRequest
  readonly primaryButtonRef: RefObject<HTMLButtonElement | null>
  onAuthenticationFailure(code: ReportDocumentAuthenticationCode): void
}

export function ReportDocumentActions({
  api,
  request,
  primaryButtonRef,
  onAuthenticationFailure
}: ReportDocumentActionsProps): React.JSX.Element {
  const [busyAction, setBusyAction] = useState<'SAVE' | 'PRINT' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const run = async (action: 'SAVE' | 'PRINT'): Promise<void> => {
    if (busyAction !== null) return
    setBusyAction(action)
    setMessage(action === 'SAVE' ? 'Creating PDF...' : 'Opening printer...')
    const previousTitle = document.title
    document.title = request.suggestedFileName.replace(/\.pdf$/iu, '')

    try {
      const result = action === 'SAVE' ? await api.savePdf(request) : await api.print(request)
      if (!result.ok) {
        if (isAuthenticationCode(result.error.code)) {
          onAuthenticationFailure(result.error.code)
          return
        }
        setMessage(result.error.message)
        return
      }

      if (result.data.status === 'SAVED') {
        setMessage(`PDF saved as ${result.data.fileName}.`)
      } else if (result.data.status === 'PRINTED') {
        setMessage('The report was sent to the printer.')
      } else if (result.data.status === 'CANCELLED') {
        setMessage(action === 'SAVE' ? 'PDF save cancelled.' : 'Printing cancelled.')
      } else {
        setMessage('The report document could not be created.')
      }
    } catch {
      setMessage('The report document service is unavailable.')
    } finally {
      document.title = previousTitle
      setBusyAction(null)
    }
  }

  return (
    <div className="patient-report-document-actions">
      <div>
        <button
          ref={primaryButtonRef}
          className="button button-primary"
          type="button"
          disabled={busyAction !== null}
          onClick={() => void run('SAVE')}
        >
          <DownloadIcon />
          {busyAction === 'SAVE' ? 'Creating PDF...' : 'Save PDF'}
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busyAction !== null}
          onClick={() => void run('PRINT')}
        >
          <PrintIcon />
          {busyAction === 'PRINT' ? 'Opening printer...' : 'Print'}
        </button>
      </div>
      {message === null ? null : (
        <span className="patient-report-document-status" role="status" aria-live="polite">
          {message}
        </span>
      )}
    </div>
  )
}

function DownloadIcon(): React.JSX.Element {
  return (
    <svg className="patient-report-print-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 18v3h16v-3" />
    </svg>
  )
}

function PrintIcon(): React.JSX.Element {
  return (
    <svg className="patient-report-print-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
    </svg>
  )
}

function isAuthenticationCode(
  code: ReportDocumentErrorCode
): code is ReportDocumentAuthenticationCode {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED'
  )
}
