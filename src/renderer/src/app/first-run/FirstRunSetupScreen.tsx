import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  createFirstRunSubmissionController,
  type FirstRunSubmissionController
} from './first-run-controller'
import {
  defaultFirstRunTimeZone,
  firstRunFormCopy,
  firstRunLocationTypeOptions,
  passwordMismatchMessage,
  readFirstRunSetupFormValues,
  reviewFormMessage
} from './first-run-form'
import type { RendererStartupState, SetupSubmissionState } from './first-run-types'
import { ShellStatusSummary } from './FirstRunStateScreen'

interface FirstRunSetupScreenProps {
  api: HealthScreeningApi
  state: Extract<RendererStartupState, { status: 'SETUP_REQUIRED' }>
  onStartupState(state: RendererStartupState): void
  onExit(): void
}

type ErrorFocusTarget = 'summary' | 'confirm' | 'invalid'

export function FirstRunSetupScreen({
  api,
  state,
  onStartupState,
  onExit
}: FirstRunSetupScreenProps): React.JSX.Element {
  const [submissionState, setSubmissionState] = useState<SetupSubmissionState>({ status: 'IDLE' })
  const formRef = useRef<HTMLFormElement | null>(null)
  const errorSummaryRef = useRef<HTMLDivElement | null>(null)
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null)
  const controllerRef = useRef<FirstRunSubmissionController | null>(null)
  const errorFocusTargetRef = useRef<ErrorFocusTarget>('summary')

  const clearSensitiveForm = useCallback(() => {
    formRef.current?.reset()
  }, [])

  const handleSubmissionState = useCallback((nextState: SetupSubmissionState) => {
    if (nextState.status === 'FORM_ERROR' || nextState.status === 'SERVICE_ERROR') {
      errorFocusTargetRef.current = 'summary'
    }

    setSubmissionState(nextState)
  }, [])

  useEffect(() => {
    const controller = createFirstRunSubmissionController({
      api,
      info: state.info,
      health: state.health,
      onSubmissionState: handleSubmissionState,
      onStartupState,
      onClearSensitiveForm: clearSensitiveForm
    })

    controllerRef.current = controller

    return () => {
      controller.dispose()

      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }, [api, clearSensitiveForm, handleSubmissionState, onStartupState, state.health, state.info])

  useEffect(() => {
    if (submissionState.status !== 'FORM_ERROR' && submissionState.status !== 'SERVICE_ERROR') {
      return
    }

    if (errorFocusTargetRef.current === 'confirm') {
      confirmPasswordRef.current?.focus()
      return
    }

    if (errorFocusTargetRef.current === 'summary') {
      errorSummaryRef.current?.focus()
    }
  }, [submissionState])

  const isSubmitting = submissionState.status === 'SUBMITTING'

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const form = event.currentTarget

    if (!form.checkValidity()) {
      errorFocusTargetRef.current = 'invalid'
      setSubmissionState({ status: 'FORM_ERROR', message: reviewFormMessage })
      form.reportValidity()
      focusFirstInvalidControl(form)
      return
    }

    const values = readFirstRunSetupFormValues(new FormData(form))

    if (values.temporaryPassword !== values.confirmTemporaryPassword) {
      errorFocusTargetRef.current = 'confirm'
      setSubmissionState({ status: 'FORM_ERROR', message: passwordMismatchMessage })
      return
    }

    void controllerRef.current?.submit(values)
  }

  return (
    <section className="foundation-panel setup-panel" aria-labelledby="setup-required-heading">
      <div className="foundation-eyebrow">Local setup</div>
      <h1 id="setup-required-heading">{firstRunFormCopy.heading}</h1>
      <p className="foundation-statement">{firstRunFormCopy.statement}</p>
      <p className="setup-offline-statement">{firstRunFormCopy.offlineStatement}</p>

      <form
        ref={formRef}
        className="setup-form"
        aria-busy={isSubmitting}
        aria-describedby="setup-form-guidance"
        onSubmit={handleSubmit}
        noValidate={false}
      >
        <p id="setup-form-guidance" className="setup-required-note">
          Fields marked required must be completed.
        </p>

        {submissionState.status === 'FORM_ERROR' || submissionState.status === 'SERVICE_ERROR' ? (
          <div ref={errorSummaryRef} className="setup-error-summary" role="alert" tabIndex={-1}>
            {submissionState.message}
          </div>
        ) : null}

        <fieldset className="setup-fieldset" disabled={isSubmitting}>
          <legend>Installation</legend>
          <div className="setup-grid">
            <div className="setup-field">
              <label htmlFor="deploymentName">Deployment name required</label>
              <input
                id="deploymentName"
                name="deploymentName"
                type="text"
                required
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="setup-field">
              <label htmlFor="timeZone">Time zone required</label>
              <input
                id="timeZone"
                name="timeZone"
                type="text"
                required
                maxLength={64}
                defaultValue={defaultFirstRunTimeZone}
                spellCheck={false}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="setup-fieldset" disabled={isSubmitting}>
          <legend>Administrator</legend>
          <div className="setup-grid">
            <div className="setup-field">
              <label htmlFor="username">Administrator username required</label>
              <input
                id="username"
                name="username"
                type="text"
                required
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._-]+"
                title="Use ASCII letters, numbers, periods, underscores, or hyphens."
                autoComplete="username"
                aria-describedby="username-help"
              />
              <p id="username-help" className="setup-helper">
                Use ASCII letters, numbers, periods, underscores, or hyphens.
              </p>
            </div>
            <div className="setup-field">
              <label htmlFor="displayName">Administrator display name required</label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                required
                maxLength={120}
                autoComplete="name"
              />
            </div>
            <div className="setup-field">
              <label htmlFor="temporaryPassword">Temporary password required</label>
              <input
                id="temporaryPassword"
                name="temporaryPassword"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                aria-describedby="temporary-password-help"
              />
              <p id="temporary-password-help" className="setup-helper">
                Use 12 to 128 characters. Setup applies the authoritative password policy.
              </p>
            </div>
            <div className="setup-field">
              <label htmlFor="confirmTemporaryPassword">Confirm temporary password required</label>
              <input
                ref={confirmPasswordRef}
                id="confirmTemporaryPassword"
                name="confirmTemporaryPassword"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="setup-fieldset" disabled={isSubmitting}>
          <legend>Configured screening location</legend>
          <div className="setup-grid">
            <div className="setup-field">
              <label htmlFor="locationName">Location name required</label>
              <input id="locationName" name="locationName" type="text" required maxLength={120} />
            </div>
            <div className="setup-field">
              <label htmlFor="locationType">Location type required</label>
              <select id="locationType" name="locationType" required defaultValue="CHURCH">
                {firstRunLocationTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="setup-field">
              <label htmlFor="village">Village</label>
              <input id="village" name="village" type="text" maxLength={120} />
            </div>
            <div className="setup-field">
              <label htmlFor="subdivision">Subdivision</label>
              <input id="subdivision" name="subdivision" type="text" maxLength={120} />
            </div>
            <div className="setup-field">
              <label htmlFor="region">Region</label>
              <input id="region" name="region" type="text" maxLength={120} />
            </div>
            <div className="setup-field setup-field-wide">
              <label htmlFor="directions">Directions</label>
              <textarea id="directions" name="directions" maxLength={500} rows={4} />
            </div>
          </div>
        </fieldset>

        <div className="setup-actions">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? firstRunFormCopy.submittingLabel : firstRunFormCopy.submitLabel}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={onExit}
            disabled={isSubmitting}
          >
            {firstRunFormCopy.exitLabel}
          </button>
        </div>
      </form>

      <ShellStatusSummary info={state.info} health={state.health} />
    </section>
  )
}

function focusFirstInvalidControl(form: HTMLFormElement): void {
  const invalidControl = form.querySelector<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input:invalid, select:invalid, textarea:invalid')

  invalidControl?.focus()
}
