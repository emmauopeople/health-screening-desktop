import { useMemo, useState } from 'react'
import type {
  AuthenticationErrorCode,
  HealthScreeningApi,
  PatientAcknowledgmentStatus,
  PatientCreateRequest,
  PatientDuplicateCandidate,
  PatientSex
} from '@shared/ipc'

import { formatPatientResidence, formatPatientSex } from './patient-display'

interface PatientRegistrationWorkspaceProps {
  readonly api: HealthScreeningApi
  readonly headingId: string
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>
  onOpenPatient(patientId: string): void
  onCancel(): void
  onAuthenticationFailure(code: AuthenticationErrorCode): void
}

interface RegistrationFormState {
  readonly givenName: string
  readonly middleName: string
  readonly familyName: string
  readonly sex: PatientSex | ''
  readonly birthMode: 'DOB' | 'APPROXIMATE'
  readonly dateOfBirth: string
  readonly approximateAgeYears: string
  readonly approximateAgeAsOfDate: string
  readonly village: string
  readonly quarter: string
  readonly phone: string
  readonly acknowledgmentStatus: PatientAcknowledgmentStatus | ''
  readonly acknowledgmentReference: string
}

interface DuplicateReviewState {
  readonly candidates: readonly PatientDuplicateCandidate[]
  readonly reviewToken: string
}

const emptyForm: RegistrationFormState = Object.freeze({
  givenName: '',
  middleName: '',
  familyName: '',
  sex: '',
  birthMode: 'DOB',
  dateOfBirth: '',
  approximateAgeYears: '',
  approximateAgeAsOfDate: new Date().toISOString().slice(0, 10),
  village: '',
  quarter: '',
  phone: '',
  acknowledgmentStatus: '',
  acknowledgmentReference: ''
})

export function PatientRegistrationWorkspace({
  api,
  headingId,
  headingRef,
  onOpenPatient,
  onCancel,
  onAuthenticationFailure
}: PatientRegistrationWorkspaceProps): React.JSX.Element {
  const [form, setForm] = useState<RegistrationFormState>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState | null>(null)
  const request = useMemo(() => buildCreateRequest(form), [form])

  async function submit(reviewToken: string | null): Promise<void> {
    if (request === null) {
      setError(
        'Complete the required patient identity, demographics, residence, and acknowledgment fields.'
      )
      return
    }

    setBusy(true)
    setError(null)

    try {
      const result = await api.patient.create({
        ...request,
        reviewedDuplicateToken: reviewToken
      })

      if (!result.ok) {
        if (shouldFailClosed(result.error.code)) {
          onAuthenticationFailure(result.error.code)
          return
        }

        setError(result.error.message)
        return
      }

      if (result.data.status === 'DUPLICATE_REVIEW_REQUIRED') {
        setDuplicateReview({
          candidates: result.data.candidates,
          reviewToken: result.data.reviewToken
        })
        return
      }

      setForm(emptyForm)
      setDuplicateReview(null)
      onOpenPatient(result.data.patient.patientId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="patient-registration-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading patient-workspace-heading">
        <p className="application-workspace-kicker">Patient registry</p>
        <h1 ref={headingRef} id={headingId} tabIndex={-1}>
          Register new patient
        </h1>
        <p>Create a durable local registry record after duplicate review.</p>
      </header>

      {error !== null ? (
        <div className="auth-alert patient-workspace-alert" role="alert">
          {error}
        </div>
      ) : null}

      {duplicateReview !== null ? (
        <DuplicateReviewPanel
          form={form}
          review={duplicateReview}
          busy={busy}
          onOpenPatient={onOpenPatient}
          onBackToEdit={() => setDuplicateReview(null)}
          onContinue={() => {
            void submit(duplicateReview.reviewToken)
          }}
        />
      ) : (
        <PatientRegistrationForm
          form={form}
          busy={busy}
          onFormChange={(nextForm) => setForm(nextForm)}
          onCancel={onCancel}
          onSubmit={() => {
            void submit(null)
          }}
        />
      )}
    </section>
  )
}

function PatientRegistrationForm({
  form,
  busy,
  onFormChange,
  onCancel,
  onSubmit
}: {
  readonly form: RegistrationFormState
  readonly busy: boolean
  onFormChange(form: RegistrationFormState): void
  onCancel(): void
  onSubmit(): void
}): React.JSX.Element {
  return (
    <form
      className="patient-registration-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <fieldset disabled={busy}>
        <legend>Identity</legend>
        <FormField label="Given name" required>
          <input
            value={form.givenName}
            onChange={(event) => onFormChange({ ...form, givenName: event.target.value })}
          />
        </FormField>
        <FormField label="Middle name">
          <input
            value={form.middleName}
            onChange={(event) => onFormChange({ ...form, middleName: event.target.value })}
          />
        </FormField>
        <FormField label="Family name" required>
          <input
            value={form.familyName}
            onChange={(event) => onFormChange({ ...form, familyName: event.target.value })}
          />
        </FormField>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Demographics</legend>
        <FormField label="Sex" required>
          <select
            value={form.sex}
            onChange={(event) =>
              onFormChange({ ...form, sex: event.target.value as PatientSex | '' })
            }
          >
            <option value="">Select sex</option>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
            <option value="UNKNOWN">Unknown</option>
          </select>
        </FormField>
        <FormField label="Date mode" required>
          <select
            value={form.birthMode}
            onChange={(event) =>
              onFormChange({
                ...form,
                birthMode: event.target.value as RegistrationFormState['birthMode']
              })
            }
          >
            <option value="DOB">Exact date of birth</option>
            <option value="APPROXIMATE">Approximate age</option>
          </select>
        </FormField>
        {form.birthMode === 'DOB' ? (
          <FormField label="Date of birth" required>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => onFormChange({ ...form, dateOfBirth: event.target.value })}
            />
          </FormField>
        ) : (
          <>
            <FormField label="Approximate age" required>
              <input
                type="number"
                min={0}
                max={120}
                value={form.approximateAgeYears}
                onChange={(event) =>
                  onFormChange({ ...form, approximateAgeYears: event.target.value })
                }
              />
            </FormField>
            <FormField label="Age reference date" required>
              <input
                type="date"
                value={form.approximateAgeAsOfDate}
                onChange={(event) =>
                  onFormChange({ ...form, approximateAgeAsOfDate: event.target.value })
                }
              />
            </FormField>
          </>
        )}
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Residence and contact</legend>
        <FormField label="Village" required>
          <input
            value={form.village}
            onChange={(event) => onFormChange({ ...form, village: event.target.value })}
          />
        </FormField>
        <FormField label="Quarter">
          <input
            value={form.quarter}
            onChange={(event) => onFormChange({ ...form, quarter: event.target.value })}
          />
        </FormField>
        <FormField label="Phone">
          <input
            value={form.phone}
            onChange={(event) => onFormChange({ ...form, phone: event.target.value })}
          />
        </FormField>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>Acknowledgment</legend>
        <p className="patient-registration-note">
          Record the participation and data-use acknowledgment status for this local registry entry.
        </p>
        <FormField label="Acknowledgment status" required>
          <select
            value={form.acknowledgmentStatus}
            onChange={(event) =>
              onFormChange({
                ...form,
                acknowledgmentStatus: event.target.value as PatientAcknowledgmentStatus | ''
              })
            }
          >
            <option value="">Select status</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="DECLINED">Declined</option>
            <option value="UNABLE_TO_ACKNOWLEDGE">Unable to acknowledge</option>
          </select>
        </FormField>
        <FormField label="Reference note">
          <input
            value={form.acknowledgmentReference}
            onChange={(event) =>
              onFormChange({ ...form, acknowledgmentReference: event.target.value })
            }
          />
        </FormField>
      </fieldset>

      <div className="patient-registration-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          Create patient and open tab
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function FormField({
  label,
  required = false,
  children
}: {
  readonly label: string
  readonly required?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="patient-form-field">
      <span>
        {label}
        {required ? <strong> Required</strong> : null}
      </span>
      {children}
    </label>
  )
}

function DuplicateReviewPanel({
  form,
  review,
  busy,
  onOpenPatient,
  onBackToEdit,
  onContinue
}: {
  readonly form: RegistrationFormState
  readonly review: DuplicateReviewState
  readonly busy: boolean
  onOpenPatient(patientId: string): void
  onBackToEdit(): void
  onContinue(): void
}): React.JSX.Element {
  return (
    <section className="duplicate-review-panel" aria-labelledby="duplicate-review-heading">
      <h2 id="duplicate-review-heading">Possible duplicate records</h2>
      <p>Review these deterministic possible matches before creating a new local patient record.</p>
      <div className="duplicate-entered-values">
        <h3>Entered values</h3>
        <dl>
          <div>
            <dt>Name</dt>
            <dd>{[form.givenName, form.middleName, form.familyName].filter(Boolean).join(' ')}</dd>
          </div>
          <div>
            <dt>Age / DOB</dt>
            <dd>
              {form.birthMode === 'DOB'
                ? form.dateOfBirth
                : `${form.approximateAgeYears} as of ${form.approximateAgeAsOfDate}`}
            </dd>
          </div>
          <div>
            <dt>Sex</dt>
            <dd>{form.sex === '' ? 'Not selected' : formatPatientSex(form.sex)}</dd>
          </div>
          <div>
            <dt>Residence</dt>
            <dd>{[form.village, form.quarter].filter(Boolean).join(' / ')}</dd>
          </div>
        </dl>
      </div>
      <div className="duplicate-candidate-list">
        {review.candidates.map((candidate) => (
          <article key={candidate.patient.patientId} className="duplicate-candidate">
            <div>
              <strong>
                {candidate.patient.patientCode} {candidate.patient.displayName}
              </strong>
              <span>
                {candidate.patient.ageDobDisplay} / {formatPatientSex(candidate.patient.sex)} /{' '}
                {formatPatientResidence(candidate.patient)}
              </span>
            </div>
            <ul>
              {candidate.reasonLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onOpenPatient(candidate.patient.patientId)}
            >
              Open existing
            </button>
          </article>
        ))}
      </div>
      <div className="patient-registration-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={busy}
          onClick={onContinue}
        >
          Continue registration
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={onBackToEdit}
        >
          Return to edit
        </button>
      </div>
    </section>
  )
}

function buildCreateRequest(form: RegistrationFormState): PatientCreateRequest | null {
  if (
    form.givenName.trim().length === 0 ||
    form.familyName.trim().length === 0 ||
    form.sex === '' ||
    form.village.trim().length === 0 ||
    form.acknowledgmentStatus === ''
  ) {
    return null
  }

  if (form.birthMode === 'DOB' && form.dateOfBirth.length === 0) {
    return null
  }

  if (
    form.birthMode === 'APPROXIMATE' &&
    (form.approximateAgeYears.length === 0 || form.approximateAgeAsOfDate.length === 0)
  ) {
    return null
  }

  return {
    givenName: form.givenName,
    middleName: form.middleName.trim().length === 0 ? null : form.middleName,
    familyName: form.familyName,
    sex: form.sex,
    dateOfBirth: form.birthMode === 'DOB' ? form.dateOfBirth : null,
    approximateAgeYears:
      form.birthMode === 'APPROXIMATE' ? Number.parseInt(form.approximateAgeYears, 10) : null,
    approximateAgeAsOfDate: form.birthMode === 'APPROXIMATE' ? form.approximateAgeAsOfDate : null,
    village: form.village,
    quarter: form.quarter.trim().length === 0 ? null : form.quarter,
    phone: form.phone.trim().length === 0 ? null : form.phone,
    acknowledgmentStatus: form.acknowledgmentStatus,
    acknowledgmentReference:
      form.acknowledgmentReference.trim().length === 0 ? null : form.acknowledgmentReference,
    reviewedDuplicateToken: null
  }
}

function shouldFailClosed(code: AuthenticationErrorCode): boolean {
  return (
    code === 'IPC_FORBIDDEN' ||
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTHORIZATION_FAILED' ||
    code === 'AUTHENTICATION_UNAVAILABLE'
  )
}
