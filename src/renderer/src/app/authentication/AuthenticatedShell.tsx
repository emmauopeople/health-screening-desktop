import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthLockResult,
  AuthLogoutResult,
  HealthScreeningApi,
  PatientErrorCode
} from '@shared/ipc'

import {
  createAuthenticationFormController,
  type AuthenticationFormController,
  type AuthenticationOperationState
} from './authentication-form-controller'
import {
  applyAuthenticationFailureRouteAction,
  classifyAuthenticationFailureAction,
  classifyThrownAuthenticationFailureAction,
  type AuthenticationInteractiveOperation
} from './authentication-failure-actions'
import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import type { RendererAuthenticationRoute } from './authentication-route-types'
import { ApplicationShell, type ApplicationShellContext } from '../shell'

interface AuthenticatedShellProps {
  readonly api: HealthScreeningApi
  readonly route: Extract<RendererAuthenticationRoute, { status: 'SESSION_ACTIVE' }>
  readonly controller: RendererAuthenticationRouteController
  readonly shellContext: ApplicationShellContext
}

export function AuthenticatedShell({
  api,
  route,
  controller,
  shellContext
}: AuthenticatedShellProps): React.JSX.Element {
  const [operationState, setOperationState] = useState<AuthenticationOperationState>({
    status: 'IDLE'
  })
  const alertRef = useRef<HTMLDivElement | null>(null)
  const formControllerRef = useRef<AuthenticationFormController | null>(null)
  const patientReconcilePendingRef = useRef(false)

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

  const handlePatientAuthenticationFailure = useCallback(
    (code: PatientErrorCode): void => {
      if (code === 'IPC_FORBIDDEN') {
        controller.showUnavailable(true)
        return
      }

      if (
        code !== 'AUTH_LOCKED' &&
        code !== 'AUTH_UNAUTHENTICATED' &&
        code !== 'AUTH_PASSWORD_CHANGE_REQUIRED'
      ) {
        return
      }

      if (patientReconcilePendingRef.current) {
        return
      }

      patientReconcilePendingRef.current = true
      void controller.reconcile().finally(() => {
        patientReconcilePendingRef.current = false
      })
    },
    [controller]
  )

  async function handleLock(): Promise<void> {
    await runSessionTransition('LOCK', () => api.auth.lock())
  }

  async function handleLogout(): Promise<void> {
    await runSessionTransition('LOGOUT', () => api.auth.logout())
  }

  async function runSessionTransition(
    operationKind: Extract<AuthenticationInteractiveOperation, 'LOCK' | 'LOGOUT'>,
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

      const action = classifyAuthenticationFailureAction(operationKind, result.error.code)
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
    <ApplicationShell
      key={route.user.role}
      api={api}
      authGeneration={route.revision}
      context={shellContext}
      user={route.user}
      busy={isSubmitting}
      operationError={operationState.status === 'ERROR' ? operationState.message : null}
      alertRef={alertRef}
      onLock={() => {
        void handleLock()
      }}
      onLogout={() => {
        void handleLogout()
      }}
      onPatientAuthenticationFailure={handlePatientAuthenticationFailure}
    />
  )
}
