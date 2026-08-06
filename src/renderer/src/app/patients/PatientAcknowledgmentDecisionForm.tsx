import { useEffect, useRef } from 'react'

import type { PatientAcknowledgmentStatus, PublicPatientDetail } from '@shared/ipc'

import {
  countUnicodeCodePoints,
  type PatientAcknowledgmentDecisionSelection,
  type PatientAcknowledgmentDecisionValidationErrors
} from './patient-acknowledgment-decision'
import { formatAcknowledgmentStatusLabel } from './patient-history-formatting'

export interface PatientAcknowledgmentDecisionConflictView {
  readonly latestStatus: PatientAcknowledgmentStatus
  readonly latestUpdatedAt: string
  readonly latestUpdatedByDisplayName: string
  readonly intendedDecision: PatientAcknowledgmentDecisionSelection
}

interface PatientAcknowledgmentDecisionFormProps {
  readonly patient: PublicPatientDetail
  readonly decision: PatientAcknowledgmentDecisionSelection
  readonly note: string
  readonly validationErrors: PatientAcknowledgmentDecisionValidationErrors
  readonly conflict: PatientAcknowledgmentDecisionConflictView | null
  readonly pending: boolean
  onDecisionChange(decision: PatientAcknowledgmentDecisionSelection): void
  onNoteChange(note: string): void
  onSubmit(): void
  onCancel(): void
  onReload(): void
  onReviewConflict(): void
  onRetryConflict(): void
  onDiscardConflict(): void
  onCancelConflict(): void
}

const decisionNoteMaximumCodePoints = 500

export function PatientAcknowledgmentDecisionForm({
  patient,
  decision,
  note,
  validationErrors,
  conflict,
  pending,
  onDecisionChange,
  onNoteChange,
  onSubmit,
  onCancel,
  onReload,
  onReviewConflict,
  onRetryConflict,
  onDiscardConflict,
  onCancelConflict
}: PatientAcknowledgmentDecisionFormProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const summaryRef = useRef<HTMLDivElement | null>(null)
  const conflictSummaryRef = useRef<HTMLDivElement | null>(null)
  const conflictWasVisibleRef = useRef(false)
  const decisionInvalid = validationErrors.decision !== undefined
  const noteInvalid = validationErrors.note !== undefined
  const decisionDescriptionIds = decisionInvalid
    ? 'patient-ack-decision-help patient-ack-decision-error'
    : 'patient-ack-decision-help'
  const noteDescriptionIds = noteInvalid
    ? 'patient-ack-note-count patient-ack-note-error'
    : 'patient-ack-note-count'

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (Object.keys(validationErrors).length > 0) {
      summaryRef.current?.focus({ preventScroll: true })
    }
  }, [validationErrors])

  useEffect(() => {
    const conflictVisible = conflict !== null

    if (conflictVisible && !conflictWasVisibleRef.current) {
      conflictSummaryRef.current?.focus({ preventScroll: true })
    }

    conflictWasVisibleRef.current = conflictVisible
  }, [conflict])

  return (
    <section className="patient-amendment-form" aria-labelledby="patient-ack-form-heading">
      <div className="patient-amendment-form-header">
        <h3 id="patient-ack-form-heading" ref={headingRef} tabIndex={-1}>
          Record Participation/Data-Use Acknowledgment
        </h3>
        <p className="patient-field-help">
          Current state: {formatAcknowledgmentStatusLabel(patient.acknowledgment.status)}
        </p>
      </div>

      {Object.keys(validationErrors).length > 0 ? (
        <div ref={summaryRef} className="patient-validation-summary" role="alert" tabIndex={-1}>
          <p>Correct the acknowledgment decision before saving.</p>
          <ul>
            {Object.entries(validationErrors).map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflict !== null ? (
        <div
          ref={conflictSummaryRef}
          className="patient-conflict-review"
          role="alert"
          tabIndex={-1}
        >
          <h4>Review latest acknowledgment state</h4>
          <p>No Participation/Data-Use Acknowledgment decision was recorded.</p>
          <dl className="patient-conflict-list">
            <div>
              <dt>Latest patient update</dt>
              <dd>
                {conflict.latestUpdatedAt} by {conflict.latestUpdatedByDisplayName}
              </dd>
            </div>
            <div>
              <dt>Latest current state</dt>
              <dd>{formatAcknowledgmentStatusLabel(conflict.latestStatus)}</dd>
            </div>
            <div>
              <dt>Intended decision</dt>
              <dd>
                {conflict.intendedDecision === ''
                  ? 'No decision selected'
                  : formatAcknowledgmentStatusLabel(conflict.intendedDecision)}
              </dd>
            </div>
          </dl>
          <div className="patient-detail-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onReviewConflict}
            >
              Review decision
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={onRetryConflict}
            >
              Retry decision
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onDiscardConflict}
            >
              Discard decision and load latest
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onCancelConflict}
            >
              Cancel conflict review
            </button>
          </div>
        </div>
      ) : null}

      <fieldset className="patient-field-group" disabled={pending}>
        <legend id="patient-ack-decision-legend">
          Decision{' '}
          <span className="patient-required-indicator">
            <span aria-hidden="true">*</span>
            <span className="visually-hidden"> required</span>
          </span>
        </legend>
        <p id="patient-ack-decision-help" className="patient-field-help">
          Select Acknowledged or Declined. Not requested is only an initial state.
        </p>
        <div
          role="radiogroup"
          aria-labelledby="patient-ack-decision-legend"
          aria-describedby={decisionDescriptionIds}
          aria-invalid={decisionInvalid || undefined}
          aria-required="true"
        >
          <label className="patient-radio-option">
            <input
              type="radio"
              name="patient-acknowledgment-decision"
              value="ACKNOWLEDGED"
              checked={decision === 'ACKNOWLEDGED'}
              onChange={() => onDecisionChange('ACKNOWLEDGED')}
            />
            <span>Acknowledged</span>
          </label>
          <label className="patient-radio-option">
            <input
              type="radio"
              name="patient-acknowledgment-decision"
              value="DECLINED"
              checked={decision === 'DECLINED'}
              onChange={() => onDecisionChange('DECLINED')}
            />
            <span>Declined</span>
          </label>
        </div>
        {validationErrors.decision !== undefined ? (
          <p id="patient-ack-decision-error" className="patient-validation-message">
            {validationErrors.decision}
          </p>
        ) : null}
      </fieldset>

      <label className="patient-field-wide">
        <span className="patient-field-label-text">Decision note</span>
        <textarea
          value={note}
          disabled={pending}
          maxLength={1000}
          aria-invalid={noteInvalid || undefined}
          aria-describedby={noteDescriptionIds}
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>
      <p id="patient-ack-note-count" className="patient-character-count">
        {countUnicodeCodePoints(note)} of {decisionNoteMaximumCodePoints} characters
      </p>
      {validationErrors.note !== undefined ? (
        <p id="patient-ack-note-error" className="patient-validation-message">
          {validationErrors.note}
        </p>
      ) : null}

      {pending ? (
        <p className="patient-field-help" role="status">
          Saving acknowledgment decision.
        </p>
      ) : null}

      <div className="patient-detail-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={pending}
          onClick={onSubmit}
        >
          Save decision
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={pending}
          onClick={onReload}
        >
          Reload patient
        </button>
      </div>
    </section>
  )
}
