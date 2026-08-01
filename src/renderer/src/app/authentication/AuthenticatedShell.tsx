import { useEffect, useRef, useState } from 'react'
import type { AuthLockResult, AuthLogoutResult, HealthScreeningApi } from '@shared/ipc'

import {
  authenticationFormCopy,
  createAuthenticationFormController,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { AuthenticationLayout } from './AuthenticationLayout'
import {
  authenticationUiMessages,
  mapAuthenticationFailureMessage,
  shouldReconcileAfterAuthenticationFailure
} from './authentication-message-mapping'
import { formatAuthenticationRole } from './authentication-role-labels'

interface AuthenticatedShellProps {
  readonly api: HealthScreeningApi
  readonly route: Extract<RendererAuthenticationRoute, { status: 'SESSION_ACTIVE' }>
  readonly controller: RendererAuthenticationRouteController
}

export function AuthenticatedShell({
  api,
  route,
  controller
}: AuthenticatedShellProps): React.JSX.Element {
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

  async function handleLock(): Promise<void> {
    await runSessionTransition(() => api.auth.lock())
  }

  async function handleLogout(): Promise<void> {
    await runSessionTransition(() => api.auth.logout())
  }

  async function runSessionTransition(
    operation: () => Promise<AuthLockResult | AuthLogoutResult>
  ): Promise<void> {
    const formController = formControllerRef.current
    const operationId = formController?.begin()

    if (formController === null || operationId === null || operationId === undefined) {
      return
    }

    try {
      const result = await operation()

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
      headingId="auth-workspace-heading"
      heading="Authenticated workspace."
      statement="The local account is active on this computer."
      busy={isSubmitting}
      shell
    >
      <div className="auth-shell-bar" aria-label="Authenticated session controls">
        <div className="auth-shell-title">
          <strong>Health Screening Offline Desktop</strong>
          <span>Local session only</span>
        </div>
        <div className="auth-shell-account" aria-label="Current account">
          <span>{route.user.displayName}</span>
          <span>{formatAuthenticationRole(route.user.role)}</span>
        </div>
        <div className="auth-shell-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void handleLock()
            }}
            disabled={isSubmitting}
          >
            {authenticationFormCopy.lockLabel}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              void handleLogout()
            }}
            disabled={isSubmitting}
          >
            {authenticationFormCopy.signOutLabel}
          </button>
        </div>
      </div>
      {operationState.status === 'ERROR' ? (
        <div ref={alertRef} className="auth-alert" role="alert" tabIndex={-1}>
          {operationState.message}
        </div>
      ) : null}
      <dl className="auth-identity-list" aria-label="Active local account">
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
      <section className="auth-workspace-foundation" aria-labelledby="auth-foundation-heading">
        <h2 id="auth-foundation-heading">Local application foundation</h2>
        <p>
          Authentication is complete. Screening workflows are not available in this renderer task.
        </p>
      </section>
    </AuthenticationLayout>
  )
}
