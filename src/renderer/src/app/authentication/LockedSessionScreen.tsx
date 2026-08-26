import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  clearAuthenticationPasswordFields,
  createAuthenticationFormController,
  createUnlockRequest,
  focusFirstInvalidAuthenticationControl,
  readUnlockFormValues,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import {
  applyAuthenticationFailureRouteAction,
  classifyAuthenticationFailureAction,
  classifyThrownAuthenticationFailureAction
} from './authentication-failure-actions'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { AuthenticationLayout } from './AuthenticationLayout'
import { mapLoginRejectionMessage } from './authentication-message-mapping'
import { RequiredFieldIndicator } from './RequiredFieldIndicator'

interface LockedSessionScreenProps {
  readonly api: HealthScreeningApi
  readonly route: Extract<RendererAuthenticationRoute, { status: 'SESSION_LOCKED' }>
  readonly controller: RendererAuthenticationRouteController
}

export function LockedSessionScreen({
  api,
  route,
  controller
}: LockedSessionScreenProps): React.JSX.Element {
  const [operationState, setOperationState] = useState<AuthenticationOperationState>({
    status: 'IDLE'
  })
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

    let request: ReturnType<typeof createUnlockRequest>

    try {
      request = createUnlockRequest(readUnlockFormValues(new FormData(form)))
    } catch {
      clearAuthenticationPasswordFields(form)
      formController.fail(operationId, authenticationFormCopy.reviewFormMessage)
      return
    }

    try {
      const result = await api.auth.unlock(request)

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

        form.reset()
        clearAuthenticationPasswordFields(form)
        formController.complete(operationId)
        controller.acceptSession(result.data)
        return
      }

      const action = classifyAuthenticationFailureAction('UNLOCK', result.error.code)
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

  async function handleSignOut(): Promise<void> {
    const formController = formControllerRef.current
    const operationId = formController?.begin()

    if (formController === null || operationId === null || operationId === undefined) {
      return
    }

    try {
      const result = await api.auth.logout()

      if (!formController.isCurrent(operationId)) {
        return
      }

      if (result.ok) {
        formController.complete(operationId)
        controller.acceptSession(result.data)
        return
      }

      const action = classifyAuthenticationFailureAction('LOGOUT', result.error.code)
      formController.fail(operationId, action.message)
      await applyAuthenticationFailureRouteAction(controller, action)
    } catch {
      if (formController.isCurrent(operationId)) {
        const action = classifyThrownAuthenticationFailureAction()
        formController.fail(operationId, action.message)
        await applyAuthenticationFailureRouteAction(controller, action)
      }
    }
  }

  return (
    <div className="auth-login-page">
      <div className="auth-login-content">
        <div className="auth-login-surface auth-locked-surface">
          <div className="auth-locked-logo" role="img" aria-label="Community Health Screening" />
          <AuthenticationLayout
            headingId="auth-locked-heading"
            heading={authenticationFormCopy.lockedHeading}
            statement={`By ${route.user.username}`}
            showEyebrow={false}
            className="auth-login-card auth-login-card-joined"
            busy={isSubmitting}
          >
            <form
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
                <legend>Unlock session</legend>
                <div className="auth-field">
                  <label htmlFor="unlockPassword">
                    Password <RequiredFieldIndicator />
                  </label>
                  <input
                    id="unlockPassword"
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    autoComplete="current-password"
                  />
                </div>
              </fieldset>
              <div className="auth-actions">
                <button className="button button-primary" type="submit" disabled={isSubmitting}>
                  {isSubmitting
                    ? authenticationFormCopy.unlockSubmittingLabel
                    : authenticationFormCopy.unlockSubmitLabel}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    void handleSignOut()
                  }}
                  disabled={isSubmitting}
                >
                  {authenticationFormCopy.signOutLabel}
                </button>
              </div>
            </form>
          </AuthenticationLayout>
        </div>
      </div>
    </div>
  )
}
