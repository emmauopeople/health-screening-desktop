import { useCallback, useEffect, useRef, useState } from 'react'

import {
  authenticationFormCopy,
  createAuthenticationFormController,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import { authenticationRouteCopy } from './authentication-route-controller'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { AuthenticationLayout } from './AuthenticationLayout'

interface AuthenticationUnavailableScreenProps {
  readonly route: Extract<RendererAuthenticationRoute, { status: 'AUTH_UNAVAILABLE' }>
  readonly controller: RendererAuthenticationRouteController
  onExit(): void
}

export function AuthenticationUnavailableScreen({
  route,
  controller,
  onExit
}: AuthenticationUnavailableScreenProps): React.JSX.Element {
  const [operationState, setOperationState] = useState<AuthenticationOperationState>({
    status: 'IDLE'
  })
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

  const retry = useCallback(() => {
    const formController = formControllerRef.current
    const operationId = formController?.begin()

    if (formController === null || operationId === null || operationId === undefined) {
      return
    }

    void (async () => {
      try {
        await controller.load()
        formController.complete(operationId)
      } catch {
        formController.fail(operationId, authenticationRouteCopy.unavailableStatement)
      }
    })()
  }, [controller])

  const isSubmitting = operationState.status === 'SUBMITTING'

  return (
    <AuthenticationLayout
      headingId="auth-unavailable-heading"
      heading={authenticationRouteCopy.unavailableHeading}
      statement={route.message}
      busy={isSubmitting}
    >
      {operationState.status === 'ERROR' ? (
        <div className="auth-alert" role="alert">
          {operationState.message}
        </div>
      ) : null}
      <div className="auth-actions">
        {route.retryable ? (
          <button
            className="button button-primary"
            type="button"
            onClick={retry}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Retrying...' : authenticationRouteCopy.retryLabel}
          </button>
        ) : null}
        <button
          className="button button-secondary"
          type="button"
          onClick={onExit}
          disabled={isSubmitting}
        >
          {authenticationFormCopy.exitLabel}
        </button>
      </div>
    </AuthenticationLayout>
  )
}
