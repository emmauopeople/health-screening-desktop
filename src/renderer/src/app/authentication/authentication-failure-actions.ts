import type { AuthenticationErrorCode, AuthForcedPasswordChangeRejectionReason } from '@shared/ipc'

import type { RendererAuthenticationRouteController } from './authentication-route-controller'
import {
  authenticationUiMessages,
  mapAuthenticationFailureMessage
} from './authentication-message-mapping'

export type AuthenticationInteractiveOperation =
  'LOGIN' | 'PASSWORD_CHANGE' | 'UNLOCK' | 'LOCK' | 'LOGOUT' | 'PATIENT'

export type AuthenticationFailureAction =
  | {
      readonly kind: 'MESSAGE_ONLY'
      readonly message: string
    }
  | {
      readonly kind: 'RECONCILE'
      readonly message: string
    }
  | {
      readonly kind: 'FORBIDDEN_UNAVAILABLE'
      readonly message: string
    }

export function classifyAuthenticationFailureAction(
  operation: AuthenticationInteractiveOperation,
  code: AuthenticationErrorCode
): AuthenticationFailureAction {
  if (code === 'IPC_FORBIDDEN') {
    return {
      kind: 'FORBIDDEN_UNAVAILABLE',
      message: mapAuthenticationFailureMessage(code)
    }
  }

  if (operation === 'LOCK' || operation === 'LOGOUT') {
    return {
      kind: 'RECONCILE',
      message: mapAuthenticationFailureMessage(code)
    }
  }

  if (code === 'VALIDATION_FAILED' || code === 'AUTH_OPERATION_IN_PROGRESS') {
    return {
      kind: 'MESSAGE_ONLY',
      message: mapAuthenticationFailureMessage(code)
    }
  }

  if (isStateChangingOrUncertainFailure(code)) {
    return {
      kind: 'RECONCILE',
      message: mapAuthenticationFailureMessage(code)
    }
  }

  return {
    kind: 'MESSAGE_ONLY',
    message: mapAuthenticationFailureMessage(code)
  }
}

export function classifyThrownAuthenticationFailureAction(): AuthenticationFailureAction {
  return {
    kind: 'RECONCILE',
    message: authenticationUiMessages.unavailable
  }
}

export async function applyAuthenticationFailureRouteAction(
  controller: RendererAuthenticationRouteController,
  action: AuthenticationFailureAction
): Promise<void> {
  if (action.kind === 'FORBIDDEN_UNAVAILABLE') {
    controller.showUnavailable(true)
    return
  }

  if (action.kind !== 'RECONCILE') {
    return
  }

  try {
    await controller.reconcile()
  } catch {
    return
  }
}

export function shouldReconcileAfterPasswordChangeRejection(
  reason: AuthForcedPasswordChangeRejectionReason
): boolean {
  return reason === 'ACCOUNT_INACTIVE' || reason === 'PASSWORD_CHANGE_NOT_REQUIRED'
}

function isStateChangingOrUncertainFailure(code: AuthenticationErrorCode): boolean {
  return (
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTH_CONCURRENCY' ||
    code === 'AUTH_STATE_INTEGRITY' ||
    code === 'IPC_UNAVAILABLE' ||
    code === 'AUTHENTICATION_UNAVAILABLE' ||
    code === 'INTERNAL_ERROR'
  )
}
