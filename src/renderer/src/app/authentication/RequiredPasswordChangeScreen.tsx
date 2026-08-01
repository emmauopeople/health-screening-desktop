import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  authenticationPasswordHelp,
  clearAuthenticationPasswordFields,
  createAuthenticationFormController,
  createRequiredPasswordChangeRequest,
  focusFirstInvalidAuthenticationControl,
  readRequiredPasswordChangeFormValues,
  requiredPasswordChangeFieldsMatch,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { AuthenticationLayout } from './AuthenticationLayout'
import {
  authenticationUiMessages,
  mapAuthenticationFailureMessage,
  mapPasswordChangeRejectionMessage,
  shouldReconcileAfterAuthenticationFailure
} from './authentication-message-mapping'
import { formatAuthenticationRole } from './authentication-role-labels'

interface RequiredPasswordChangeScreenProps {
  readonly api: HealthScreeningApi
  readonly route: Extract<RendererAuthenticationRoute, { status: 'PASSWORD_CHANGE_REQUIRED' }>
  readonly controller: RendererAuthenticationRouteController
}

export function RequiredPasswordChangeScreen({
  api,
  route,
  controller
}: RequiredPasswordChangeScreenProps): React.JSX.Element {
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

    const values = readRequiredPasswordChangeFormValues(new FormData(form))

    if (!requiredPasswordChangeFieldsMatch(values)) {
      clearAuthenticationPasswordFields(form)
      formController.fail(operationId, authenticationUiMessages.newPasswordMismatch)
      return
    }

    let request: ReturnType<typeof createRequiredPasswordChangeRequest>

    try {
      request = createRequiredPasswordChangeRequest(values)
    } catch {
      clearAuthenticationPasswordFields(form)
      formController.fail(operationId, authenticationFormCopy.reviewFormMessage)
      return
    }

    try {
      const result = await api.auth.changeRequiredPassword(request)

      if (!formController.isCurrent(operationId)) {
        return
      }

      clearAuthenticationPasswordFields(form)

      if (result.ok) {
        if (result.data.status === 'REJECTED') {
          formController.fail(operationId, mapPasswordChangeRejectionMessage(result.data))
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

      formController.fail(operationId, mapAuthenticationFailureMessage(result.error.code))

      if (shouldReconcileAfterAuthenticationFailure(result.error.code)) {
        await controller.reconcile()
      }
    } catch {
      if (formController.isCurrent(operationId)) {
        formController.fail(operationId, authenticationUiMessages.unavailable)
      }
    }
  }

  return (
    <AuthenticationLayout
      headingId="auth-password-change-heading"
      heading={authenticationFormCopy.passwordChangeHeading}
      statement={authenticationFormCopy.passwordChangeStatement}
      busy={isSubmitting}
    >
      <dl className="auth-identity-list" aria-label="Current local account">
        <div>
          <dt>User</dt>
          <dd>{route.user.displayName}</dd>
        </div>
        <div>
          <dt>Username</dt>
          <dd>{route.user.username}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{formatAuthenticationRole(route.user.role)}</dd>
        </div>
      </dl>
      <p className="auth-deadline">Required change expires {formatDeadline(route.expiresAt)}.</p>
      <form
        className="auth-form"
        aria-busy={isSubmitting}
        aria-describedby="auth-password-change-guidance"
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <p id="auth-password-change-guidance" className="auth-helper">
          Fields marked required must be completed.
        </p>
        {operationState.status === 'ERROR' ? (
          <div ref={alertRef} className="auth-alert" role="alert" tabIndex={-1}>
            {operationState.message}
          </div>
        ) : null}
        <fieldset className="auth-fieldset" disabled={isSubmitting}>
          <legend>Password change</legend>
          <div className="auth-grid">
            <div className="auth-field">
              <label htmlFor="currentPassword">Current password required</label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                aria-describedby="auth-current-password-help"
              />
              <p id="auth-current-password-help" className="auth-helper">
                {authenticationPasswordHelp}
              </p>
            </div>
            <div className="auth-field">
              <label htmlFor="newPassword">New password required</label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                autoComplete="new-password"
                aria-describedby="auth-new-password-help"
              />
              <p id="auth-new-password-help" className="auth-helper">
                The desktop service validates the new password policy.
              </p>
            </div>
            <div className="auth-field auth-field-wide">
              <label htmlFor="confirmNewPassword">Confirm new password required</label>
              <input
                id="confirmNewPassword"
                name="confirmNewPassword"
                type="password"
                required
                autoComplete="new-password"
              />
            </div>
          </div>
        </fieldset>
        <div className="auth-actions">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? authenticationFormCopy.passwordChangeSubmittingLabel
              : authenticationFormCopy.passwordChangeSubmitLabel}
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
  )
}

function formatDeadline(timestamp: string): string {
  const date = new Date(timestamp)

  if (!Number.isFinite(date.getTime())) {
    return 'soon'
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
