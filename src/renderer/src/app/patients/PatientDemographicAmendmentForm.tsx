import { useEffect, useMemo, useRef } from 'react'
import type { FormEvent } from 'react'

import type { LocalUserRole } from '@shared/ipc'

import {
  canRoleChangePatientStatus,
  countUnicodeCodePoints,
  patientDemographicAmendmentReasonOptions,
  type PatientDemographicAmendmentReasonSelection,
  type PatientDemographicAmendmentValidationErrors,
  type PatientDemographicConflictField,
  type PatientDemographicDraft,
  type PatientDemographicDraftField,
  updatePatientDemographicDraftField
} from './patient-demographic-amendment'
import {
  formatDemographicFieldLabel,
  formatDemographicReasonLabel,
  formatHistoryValue
} from './patient-history-formatting'

export interface PatientDemographicAmendmentConflictView {
  readonly latestUpdatedAt: string
  readonly latestUpdatedByDisplayName: string
  readonly overlappingFields: readonly PatientDemographicConflictField[]
}

interface PatientDemographicAmendmentFormProps {
  readonly draft: PatientDemographicDraft
  readonly reasonCode: PatientDemographicAmendmentReasonSelection
  readonly reasonNote: string
  readonly validationErrors: PatientDemographicAmendmentValidationErrors
  readonly conflict: PatientDemographicAmendmentConflictView | null
  readonly pending: boolean
  readonly userRole: LocalUserRole
  readonly today: string
  onDraftChange(draft: PatientDemographicDraft): void
  onReasonCodeChange(reasonCode: PatientDemographicAmendmentReasonSelection): void
  onReasonNoteChange(reasonNote: string): void
  onSubmit(): void
  onCancel(): void
  onReload(): void
  onReviewConflict(): void
  onRetryConflict(): void
  onDiscardConflict(): void
  onCancelConflict(): void
}

const maximumReasonNoteCodePoints = 500

export function PatientDemographicAmendmentForm({
  draft,
  reasonCode,
  reasonNote,
  validationErrors,
  conflict,
  pending,
  userRole,
  today,
  onDraftChange,
  onReasonCodeChange,
  onReasonNoteChange,
  onSubmit,
  onCancel,
  onReload,
  onReviewConflict,
  onRetryConflict,
  onDiscardConflict,
  onCancelConflict
}: PatientDemographicAmendmentFormProps): React.JSX.Element {
  const headingRef = useRef<HTMLHeadingElement | null>(null)
  const errorSummaryRef = useRef<HTMLDivElement | null>(null)
  const canChangeStatus = canRoleChangePatientStatus(userRole)
  const errorItems = useMemo(() => Object.values(validationErrors), [validationErrors])
  const noteLength = countUnicodeCodePoints(reasonNote)
  const exactDobActive = draft.dateOfBirth !== null
  const approximateAgeActive = draft.approximateAgeYears !== null

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (errorItems.length > 0) {
      errorSummaryRef.current?.focus({ preventScroll: true })
    }
  }, [errorItems.length])

  const update = <TKey extends PatientDemographicDraftField>(
    key: TKey,
    value: PatientDemographicDraft[TKey]
  ): void => {
    if (key === 'status' && !canChangeStatus) {
      return
    }

    onDraftChange(updatePatientDemographicDraftField(draft, key, value, today))
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form className="patient-amendment-form" noValidate onSubmit={submit}>
      <div className="patient-detail-header">
        <h2 ref={headingRef} tabIndex={-1}>
          Edit Demographic
        </h2>
        <span>{pending ? 'Saving' : 'Draft amendment'}</span>
      </div>

      {errorItems.length > 0 ? (
        <div
          ref={errorSummaryRef}
          className="patient-validation-summary"
          role="alert"
          tabIndex={-1}
        >
          <h3>Review the demographic amendment</h3>
          <ul>
            {errorItems.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conflict !== null ? (
        <div className="patient-conflict-review" role="alert">
          <h3>Patient changed before this amendment was saved</h3>
          <p>
            Latest update: {conflict.latestUpdatedAt} by {conflict.latestUpdatedByDisplayName}. No
            overwrite has occurred.
          </p>
          {conflict.overlappingFields.length > 0 ? (
            <div className="patient-history-table-scroll">
              <table className="patient-history-table">
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Original value</th>
                    <th scope="col">Latest value</th>
                    <th scope="col">Your intended value</th>
                  </tr>
                </thead>
                <tbody>
                  {conflict.overlappingFields.map((field) => (
                    <tr key={field.fieldName}>
                      <td>{formatDemographicFieldLabel(field.fieldName)}</td>
                      <td>{formatHistoryValue(field.originalValue)}</td>
                      <td>{formatHistoryValue(field.latestValue)}</td>
                      <td>{formatHistoryValue(field.intendedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No edited field was changed by the concurrent update.</p>
          )}
          <div className="patient-detail-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onReviewConflict}
            >
              Review rebased amendment
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={onRetryConflict}
            >
              Retry amendment
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={pending}
              onClick={onDiscardConflict}
            >
              Discard amendment and load latest
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

      <fieldset className="patient-amendment-section" disabled={pending}>
        <legend>Patient demographics</legend>
        <div
          className="patient-field-group patient-field-wide"
          role="group"
          aria-labelledby="patient-amendment-name-label"
          aria-describedby={joinDescriptionIds(
            validationErrors.name !== undefined ? 'patient-amendment-name-error' : undefined
          )}
          aria-required="true"
        >
          <div id="patient-amendment-name-label" className="patient-field-group-label">
            Patient name <RequiredIndicator />
          </div>
          <div className="patient-field-group-grid">
            <TextField
              label="Given name"
              value={draft.givenName}
              invalid={validationErrors.name !== undefined}
              describedBy={joinDescriptionIds(
                validationErrors.name !== undefined ? 'patient-amendment-name-error' : undefined
              )}
              onChange={(value) => update('givenName', value)}
            />
            <TextField
              label="Family name"
              value={draft.familyName}
              invalid={validationErrors.name !== undefined}
              describedBy={joinDescriptionIds(
                validationErrors.name !== undefined ? 'patient-amendment-name-error' : undefined
              )}
              onChange={(value) => update('familyName', value)}
            />
            <TextField
              label="Other names"
              value={draft.otherNames}
              invalid={validationErrors.name !== undefined}
              describedBy={joinDescriptionIds(
                validationErrors.name !== undefined ? 'patient-amendment-name-error' : undefined
              )}
              onChange={(value) => update('otherNames', value)}
            />
          </div>
          <ValidationMessage id="patient-amendment-name-error" message={validationErrors.name} />
        </div>

        <div
          className="patient-field-group patient-field-wide"
          role="group"
          aria-describedby={joinDescriptionIds(
            validationErrors.dateOfBirth !== undefined
              ? 'patient-amendment-date-of-birth-error'
              : undefined,
            validationErrors.approximateAgeYears !== undefined
              ? 'patient-amendment-approximate-age-error'
              : undefined,
            validationErrors.ageAsOfDate !== undefined
              ? 'patient-amendment-age-as-of-date-error'
              : undefined
          )}
          aria-required="true"
        >
          <div className="patient-field-group-grid">
            <DateField
              label="Date of birth"
              value={draft.dateOfBirth}
              disabled={approximateAgeActive}
              required={!approximateAgeActive}
              invalid={validationErrors.dateOfBirth !== undefined}
              describedBy={
                validationErrors.dateOfBirth !== undefined
                  ? 'patient-amendment-date-of-birth-error'
                  : undefined
              }
              onChange={(value) => update('dateOfBirth', value)}
            />
            <NumberField
              label="Approximate age"
              value={draft.approximateAgeYears}
              disabled={exactDobActive}
              required={!exactDobActive}
              invalid={validationErrors.approximateAgeYears !== undefined}
              describedBy={joinDescriptionIds(
                validationErrors.approximateAgeYears !== undefined
                  ? 'patient-amendment-approximate-age-error'
                  : undefined
              )}
              onChange={(value) => update('approximateAgeYears', value)}
            />
            <DateField
              label="Age as of date"
              value={draft.ageAsOfDate}
              disabled={exactDobActive || !approximateAgeActive}
              required={approximateAgeActive}
              invalid={validationErrors.ageAsOfDate !== undefined}
              describedBy={joinDescriptionIds(
                validationErrors.ageAsOfDate !== undefined
                  ? 'patient-amendment-age-as-of-date-error'
                  : undefined
              )}
              onChange={(value) => update('ageAsOfDate', value)}
            />
          </div>
          <ValidationMessage
            id="patient-amendment-date-of-birth-error"
            message={validationErrors.dateOfBirth}
          />
          <ValidationMessage
            id="patient-amendment-approximate-age-error"
            message={validationErrors.approximateAgeYears}
          />
          <ValidationMessage
            id="patient-amendment-age-as-of-date-error"
            message={validationErrors.ageAsOfDate}
          />
        </div>

        <label>
          <span className="patient-field-label-text">Sex</span>
          <select
            value={draft.sex}
            onChange={(event) =>
              update('sex', event.target.value as PatientDemographicDraft['sex'])
            }
          >
            <option value="UNKNOWN">Unknown</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <TextField
          label="Village"
          value={draft.village}
          onChange={(value) => update('village', value)}
        />
        <TextField
          label="Quarter"
          value={draft.quarter}
          onChange={(value) => update('quarter', value)}
        />
        <TextField label="Phone" value={draft.phone} onChange={(value) => update('phone', value)} />
        <TextField
          label="Alternate contact"
          value={draft.alternateContactName}
          onChange={(value) => update('alternateContactName', value)}
        />
        <TextField
          label="Alternate phone"
          value={draft.alternateContactPhone}
          onChange={(value) => update('alternateContactPhone', value)}
        />
        <label className="patient-field-wide">
          <span className="patient-field-label-text">Residence notes</span>
          <textarea
            value={draft.residenceNotes ?? ''}
            onChange={(event) => update('residenceNotes', emptyToNull(event.target.value))}
          />
        </label>
        <label>
          <span className="patient-field-label-text">Status</span>
          <select
            value={draft.status}
            disabled={!canChangeStatus}
            aria-invalid={validationErrors.status !== undefined || undefined}
            aria-describedby={joinDescriptionIds(
              !canChangeStatus ? 'patient-amendment-status-restriction' : undefined,
              validationErrors.status !== undefined ? 'patient-amendment-status-error' : undefined
            )}
            onChange={(event) =>
              update('status', event.target.value as PatientDemographicDraft['status'])
            }
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        {!canChangeStatus ? (
          <p id="patient-amendment-status-restriction" className="patient-field-help">
            Only nurses and local administrators can change patient status.
          </p>
        ) : null}
        <ValidationMessage id="patient-amendment-status-error" message={validationErrors.status} />
      </fieldset>

      <fieldset className="patient-amendment-section" disabled={pending}>
        <legend>Amendment reason</legend>
        <label>
          <FieldLabelText label="Reason" required />
          <select
            value={reasonCode}
            aria-required="true"
            aria-invalid={validationErrors.reasonCode !== undefined || undefined}
            aria-describedby={
              validationErrors.reasonCode !== undefined
                ? 'patient-amendment-reason-code-error'
                : undefined
            }
            onChange={(event) =>
              onReasonCodeChange(event.target.value as PatientDemographicAmendmentReasonSelection)
            }
          >
            <option value="">Select reason</option>
            {patientDemographicAmendmentReasonOptions.map((option) => (
              <option key={option} value={option}>
                {formatDemographicReasonLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <ValidationMessage
          id="patient-amendment-reason-code-error"
          message={validationErrors.reasonCode}
        />
        <label className="patient-field-wide">
          <span className="patient-field-label-text">Reason note</span>
          <textarea
            value={reasonNote}
            maxLength={1000}
            aria-invalid={validationErrors.reasonNote !== undefined || undefined}
            aria-describedby={joinDescriptionIds(
              'patient-amendment-reason-note-count',
              validationErrors.reasonNote !== undefined
                ? 'patient-amendment-reason-note-error'
                : undefined
            )}
            onChange={(event) => onReasonNoteChange(event.target.value)}
          />
        </label>
        <p id="patient-amendment-reason-note-count" className="patient-character-count">
          {noteLength} of {maximumReasonNoteCodePoints} characters
        </p>
        <ValidationMessage
          id="patient-amendment-reason-note-error"
          message={validationErrors.reasonNote}
        />
      </fieldset>

      <div className="patient-detail-actions">
        <button type="submit" className="button button-primary" disabled={pending}>
          Save amendment
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
    </form>
  )
}

function TextField({
  label,
  value,
  disabled = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly label: string
  readonly value: string | null
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <span className="patient-field-label-text">{label}</span>
      <input
        value={value ?? ''}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </label>
  )
}

function DateField({
  label,
  value,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly label: string
  readonly value: string | null
  readonly disabled?: boolean
  readonly required?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: string | null): void
}): React.JSX.Element {
  return (
    <label>
      <FieldLabelText label={label} required={required} />
      <input
        type="date"
        value={value ?? ''}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(emptyToNull(event.target.value))}
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  disabled = false,
  required = false,
  invalid = false,
  describedBy,
  onChange
}: {
  readonly label: string
  readonly value: number | null
  readonly disabled?: boolean
  readonly required?: boolean
  readonly invalid?: boolean
  readonly describedBy?: string
  onChange(value: number | null): void
}): React.JSX.Element {
  return (
    <label>
      <FieldLabelText label={label} required={required} />
      <input
        type="number"
        min={0}
        max={120}
        value={value ?? ''}
        disabled={disabled}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
      />
    </label>
  )
}

function FieldLabelText({
  label,
  required
}: {
  readonly label: string
  readonly required: boolean
}): React.JSX.Element {
  return (
    <>
      <span className="patient-field-label-text">{label}</span>
      {required ? <RequiredIndicator /> : null}
    </>
  )
}

function RequiredIndicator(): React.JSX.Element {
  return (
    <span className="patient-required-indicator">
      <span aria-hidden="true">*</span>
      <span className="visually-hidden"> required</span>
    </span>
  )
}

function ValidationMessage({
  id,
  message
}: {
  readonly id: string
  readonly message: string | undefined
}): React.JSX.Element | null {
  if (message === undefined) {
    return null
  }

  return (
    <p id={id} className="patient-field-error">
      {message}
    </p>
  )
}

function joinDescriptionIds(...ids: Array<string | undefined>): string | undefined {
  const joined = ids.filter((id): id is string => id !== undefined).join(' ')

  return joined.length > 0 ? joined : undefined
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value
}
