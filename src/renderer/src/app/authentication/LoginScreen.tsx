import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  clearAuthenticationPasswordFields,
  createAuthenticationFormController,
  createLoginRequest,
  focusFirstInvalidAuthenticationControl,
  readLoginFormValues,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import {
  applyAuthenticationFailureRouteAction,
  classifyAuthenticationFailureAction,
  classifyThrownAuthenticationFailureAction
} from './authentication-failure-actions'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import { AuthenticationLayout } from './AuthenticationLayout'
import { mapLoginRejectionMessage } from './authentication-message-mapping'

const recoveryUnavailableMessage =
  'Username and password recovery is not available in this build. Contact an authorized administrator.'

interface LoginScreenProps {
  readonly api: HealthScreeningApi
  readonly controller: RendererAuthenticationRouteController
  onExit(): void
}

export function LoginScreen({ api, controller, onExit }: LoginScreenProps): React.JSX.Element {
  const [operationState, setOperationState] = useState<AuthenticationOperationState>({
    status: 'IDLE'
  })
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null)
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
    setRecoveryMessage(null)

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
          return
        }

        formController.complete(operationId)
        controller.acceptSession(result.data)
        return
      }

      const action = classifyAuthenticationFailureAction('LOGIN', result.error.code)
      formController.fail(operationId, action.message)
      await applyAuthenticationFailureRouteAction(controller, action)
    } catch {
      if (formController.isCurrent(operationId)) {
        clearAuthenticationPasswordFields(form)
        const action = classifyThrownAuthenticationFailureAction()
        formController.fail(operationId, action.message)
        await applyAuthenticationFailureRouteAction(controller, action)
      }
    }
  }

  return (
    <div className="auth-login-page">
      <div className="auth-login-content">
        <div className="auth-login-intro">
          <p className="auth-login-welcome">Welcome to Community Health Screening</p>
          <p className="auth-login-tagline">The One Place to Track Your Health</p>
        </div>
        <AuthenticationLayout
          headingId="auth-login-heading"
          heading={authenticationFormCopy.loginHeading}
          showEyebrow={false}
          className="auth-login-card"
          busy={isSubmitting}
        >
          <form
            ref={formRef}
            className="auth-form"
            aria-busy={isSubmitting}
            onSubmit={(event) => {
              void handleSubmit(event)
            }}
          >
            {operationState.status === 'ERROR' ? (
              <div ref={alertRef} className="auth-alert" role="alert" tabIndex={-1}>
                {operationState.message}
              </div>
            ) : null}
            <fieldset className="auth-fieldset" disabled={isSubmitting}>
              <div className="auth-field">
                <label htmlFor="username">
                  Username <RequiredFieldIndicator />
                </label>
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
                <label htmlFor="password">
                  Password <RequiredFieldIndicator />
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="current-password"
                />
              </div>
            </fieldset>
            <div className="auth-recovery">
              <button
                className="auth-recovery-action"
                type="button"
                onClick={() => setRecoveryMessage(recoveryUnavailableMessage)}
                disabled={isSubmitting}
              >
                Forgot username or password?
              </button>
              {recoveryMessage !== null ? (
                <div className="auth-recovery-message" role="alert" tabIndex={-1}>
                  {recoveryMessage}
                </div>
              ) : null}
            </div>
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
                {authenticationFormCopy.loginExitLabel}
              </button>
            </div>
          </form>
        </AuthenticationLayout>
      </div>
    </div>
  )
}

function RequiredFieldIndicator(): React.JSX.Element {
  return (
    <>
      <span className="auth-required-indicator" aria-hidden="true">
        *
      </span>
      <span className="visually-hidden"> required</span>
    </>
  )
}
