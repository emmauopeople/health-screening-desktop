import { useEffect, useRef } from 'react'
import type { PublicPatientSummary } from '@shared/ipc'

import { formatPatientTabLabel } from './patient-display'
import type { PatientWorkspaceTab } from './patient-tab-controller'

interface ReplacePatientDialogProps {
  readonly pendingPatient: PublicPatientSummary
  readonly tabs: readonly PatientWorkspaceTab[]
  onReplace(patientId: string): void
  onCancel(): void
}

interface DirtyPatientTabDialogProps {
  readonly tab: PatientWorkspaceTab
  readonly pending: boolean
  readonly error: string | null
  onSaveAndClose(): void
  onDiscardAndClose(): void
  onCancel(): void
}

export function ReplacePatientDialog({
  pendingPatient,
  tabs,
  onReplace,
  onCancel
}: ReplacePatientDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useDialogFocus(cancelRef, dialogRef)

  return (
    <div className="patient-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="patient-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replace-patient-title"
      >
        <h2 id="replace-patient-title">Open patient limit reached</h2>
        <p>
          Four patient tabs are already open. Choose one tab to close before opening{' '}
          {formatPatientTabLabel(pendingPatient)}.
        </p>
        <div className="replace-patient-list">
          {tabs.map((tab) => (
            <button
              key={tab.patientId}
              className="replace-patient-option"
              type="button"
              onClick={() => onReplace(tab.patientId)}
            >
              <span>{formatPatientTabLabel(tab.summary)}</span>
              <strong>{tab.dirty ? 'Unsaved work' : 'Clean tab'}</strong>
            </button>
          ))}
        </div>
        <div className="patient-modal-actions">
          <button
            ref={cancelRef}
            className="button button-secondary"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export function DirtyPatientTabDialog({
  tab,
  pending,
  error,
  onSaveAndClose,
  onDiscardAndClose,
  onCancel
}: DirtyPatientTabDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useDialogFocus(cancelRef, dialogRef)

  return (
    <div className="patient-modal-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="patient-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dirty-patient-title"
      >
        <h2 id="dirty-patient-title">Unsaved work in patient tab</h2>
        <p>
          {formatPatientTabLabel(tab.summary)} has uncommitted work. Choose how to handle it before
          closing the tab.
        </p>
        {error !== null ? (
          <div className="auth-alert patient-workspace-alert" role="alert">
            {error}
          </div>
        ) : null}
        <div className="patient-modal-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={pending}
            onClick={onSaveAndClose}
          >
            Save draft and close
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={onDiscardAndClose}
          >
            Discard uncommitted edits and close
          </button>
          <button
            ref={cancelRef}
            className="button button-secondary"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function useDialogFocus(
  cancelRef: React.RefObject<HTMLButtonElement | null>,
  dialogRef: React.RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancelRef.current?.click()
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusable = getFocusableDialogElements(dialogRef.current)

      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (first === undefined || last === undefined) {
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previous?.focus({ preventScroll: true })
    }
  }, [cancelRef, dialogRef])
}

function getFocusableDialogElements(dialog: HTMLDivElement | null): HTMLElement[] {
  if (dialog === null) {
    return []
  }

  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  )
}
