import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  authenticationPasswordHelp,
  clearAuthenticationPasswordFields,
  createAuthenticationFormController,
  createLoginRequest,
  focusFirstInvalidAuthenticationControl,
  readLoginFormValues,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import { AuthenticationLayout } from './AuthenticationLayout'
import {
  authenticationUiMessages,
  mapAuthenticationFailureMessage,
  mapLoginRejectionMessage,
  shouldReconcileAfterAuthenticationFailure
} from './authentication-message-mapping'

interface LoginScreenProps {
  readonly api: HealthScreeningApi
  readonly controller: RendererAuthenticationRouteController
  onExit(): void
}

export function LoginScreen({ api, controller, onExit }: LoginScreenProps): React.JSX.Element {
  const [operationState, setOperationState] = useState<AuthenticationOperationState>({
    status: 'IDLE'
  })
  const formRef = useRef<HTMLFormElement | null>(null)
  const alertRef = useRef<HTMLDivElement | null>(null)
  const formControllerRef = useRef<AuthenticationFormController | null>(null)

  if (formControllerRef.current === null) {
    formControllerRef.current = createAuthenticationFormController({ onState: setOperationState })
  }

  useEffect(() => {
    const formController = formControllerRef.current

    return () => {
      formController?.dispose()
    }
  }, [])

  useEffect(() => {
    if (operationState.status === 'ERROR') {
      alertRef.current?.focus()
    }
  }, [operationState])

  const isSubmitting = operationState.status === 'SUBMITTING'

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const form = event.currentTarget

    if (!form.checkValidity()) {
      setOperationState({
        status: 'ERROR',
        message: authenticationFormCopy.reviewFormMessage
      })
      form.reportValidity()
      focusFirstInvalidAuthenticationControl(form)
      return
    }

    const formController = formControllerRef.current
    const operationId = formController?.begin()

    if (formController === null || operationId === null || operationId === undefined) {
      return
    }

    let request: ReturnType<typeof createLoginRequest>

    try {
      request = createLoginRequest(readLoginFormValues(new FormData(form)))
    } catch {
      clearAuthenticationPasswordFields(form)
      formController.fail(operationId, authenticationFormCopy.reviewFormMessage)
      return
    }

    try {
      const result = await api.auth.login(request)

      if (!formController.isCurrent(operationId)) {
        return
      }

      clearAuthenticationPasswordFields(form)

      if (result.ok) {
        if (result.data.status === 'REJECTED') {
          formController.fail(operationId, mapLoginRejectionMessage(result.data))
          await controller.reconcile()
          return
        }

        formController.complete(operationId)
        controller.acceptSession(result.data)
        return
      }

      formController.fail(operationId, mapAuthenticationFailureMessage(result.error.code))

      if (shouldReconcileAfterAuthenticationFailure(result.error.code)) {
        await controller.reconcile()
      }
    } catch {
      if (formController.isCurrent(operationId)) {
        clearAuthenticationPasswordFields(form)
        formController.fail(operationId, authenticationUiMessages.unavailable)
      }
    }
  }

  return (
    <AuthenticationLayout
      headingId="auth-login-heading"
      heading={authenticationFormCopy.loginHeading}
      statement={authenticationFormCopy.loginStatement}
      busy={isSubmitting}
    >
      <form
        ref={formRef}
        className="auth-form"
        aria-busy={isSubmitting}
        aria-describedby="auth-login-guidance"
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <p id="auth-login-guidance" className="auth-helper">
          Fields marked required must be completed.
        </p>
        {operationState.status === 'ERROR' ? (
          <div ref={alertRef} className="auth-alert" role="alert" tabIndex={-1}>
            {operationState.message}
          </div>
        ) : null}
        <fieldset className="auth-fieldset" disabled={isSubmitting}>
          <legend>Local account</legend>
          <div className="auth-field">
            <label htmlFor="username">Username required</label>
            <input
              id="username"
              name="username"
              type="text"
              required
              maxLength={128}
              autoComplete="username"
              spellCheck={false}
            />
          </div>
          <div className="auth-field">
            <label htmlFor="password">Password required</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              aria-describedby="auth-login-password-help"
            />
            <p id="auth-login-password-help" className="auth-helper">
              {authenticationPasswordHelp}
            </p>
          </div>
        </fieldset>
        <div className="auth-actions">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? authenticationFormCopy.loginSubmittingLabel
              : authenticationFormCopy.loginSubmitLabel}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={onExit}
            disabled={isSubmitting}
          >
            {authenticationFormCopy.exitLabel}
          </button>
        </div>
      </form>
    </AuthenticationLayout>
  )
}
