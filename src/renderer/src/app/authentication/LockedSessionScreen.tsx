import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  authenticationPasswordHelp,
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
import { formatAuthenticationRole } from './authentication-role-labels'

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
    <AuthenticationLayout
      headingId="auth-locked-heading"
      heading={authenticationFormCopy.lockedHeading}
      statement={authenticationFormCopy.lockedStatement}
      busy={isSubmitting}
    >
      <dl className="auth-identity-list" aria-label="Locked local account">
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
      <p className="auth-deadline">
        {route.reason === 'IDLE_TIMEOUT'
          ? 'This session locked after inactivity.'
          : 'This session was locked manually.'}{' '}
        Session expires {formatDeadline(route.absoluteExpiresAt)}.
      </p>
      <form
        className="auth-form"
        aria-busy={isSubmitting}
        aria-describedby="auth-unlock-guidance"
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <p id="auth-unlock-guidance" className="auth-helper">
          Enter the local account password to unlock this session.
        </p>
        {operationState.status === 'ERROR' ? (
          <div ref={alertRef} className="auth-alert" role="alert" tabIndex={-1}>
            {operationState.message}
          </div>
        ) : null}
        <fieldset className="auth-fieldset" disabled={isSubmitting}>
          <legend>Unlock session</legend>
          <div className="auth-field">
            <label htmlFor="unlockPassword">Password required</label>
            <input
              id="unlockPassword"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="current-password"
              aria-describedby="auth-unlock-password-help"
            />
            <p id="auth-unlock-password-help" className="auth-helper">
              {authenticationPasswordHelp}
            </p>
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
