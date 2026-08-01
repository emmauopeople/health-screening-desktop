import { describe, expect, it, vi } from 'vitest'

import {
  applyAuthenticationFailureRouteAction,
  classifyAuthenticationFailureAction,
  classifyThrownAuthenticationFailureAction,
  shouldReconcileAfterPasswordChangeRejection
} from '../../../src/renderer/src/app/authentication/authentication-failure-actions'
import { authenticationUiMessages } from '../../../src/renderer/src/app/authentication/authentication-message-mapping'
import type { RendererAuthenticationRouteController } from '../../../src/renderer/src/app/authentication/authentication-route-controller'

describe('authentication failure action classification', () => {
  it('routes IPC_FORBIDDEN to controller-managed nonretryable unavailable', async () => {
    const controller = createController()
    const action = classifyAuthenticationFailureAction('LOGIN', 'IPC_FORBIDDEN')

    expect(action).toEqual({
      kind: 'FORBIDDEN_UNAVAILABLE',
      message: authenticationUiMessages.forbidden
    })

    await applyAuthenticationFailureRouteAction(controller, action)

    expect(controller.showUnavailable).toHaveBeenCalledWith(true)
    expect(controller.reconcile).not.toHaveBeenCalled()
  })

  it('retains the current screen for validation and operation-in-progress failures', () => {
    expect(classifyAuthenticationFailureAction('UNLOCK', 'VALIDATION_FAILED')).toMatchObject({
      kind: 'MESSAGE_ONLY'
    })
    expect(
      classifyAuthenticationFailureAction('PASSWORD_CHANGE', 'AUTH_OPERATION_IN_PROGRESS')
    ).toMatchObject({
      kind: 'MESSAGE_ONLY'
    })
  })

  it('reconciles state-changing and uncertain invocation failures exactly once', async () => {
    const controller = createController()

    for (const code of [
      'AUTH_UNAUTHENTICATED',
      'AUTH_LOCKED',
      'AUTH_PASSWORD_CHANGE_REQUIRED',
      'AUTH_CONCURRENCY',
      'AUTH_STATE_INTEGRITY',
      'IPC_UNAVAILABLE',
      'AUTHENTICATION_UNAVAILABLE',
      'INTERNAL_ERROR'
    ] as const) {
      const action = classifyAuthenticationFailureAction('LOGIN', code)
      expect(action.kind).toBe('RECONCILE')
      await applyAuthenticationFailureRouteAction(controller, action)
    }

    const thrownAction = classifyThrownAuthenticationFailureAction()
    expect(thrownAction).toEqual({
      kind: 'RECONCILE',
      message: authenticationUiMessages.unavailable
    })
    await applyAuthenticationFailureRouteAction(controller, thrownAction)

    expect(controller.reconcile).toHaveBeenCalledTimes(9)
  })

  it('always reconciles lock and logout failures except forbidden failures', () => {
    expect(classifyAuthenticationFailureAction('LOCK', 'VALIDATION_FAILED')).toMatchObject({
      kind: 'RECONCILE'
    })
    expect(
      classifyAuthenticationFailureAction('LOGOUT', 'AUTH_OPERATION_IN_PROGRESS')
    ).toMatchObject({
      kind: 'RECONCILE'
    })
    expect(classifyAuthenticationFailureAction('LOGOUT', 'IPC_FORBIDDEN')).toMatchObject({
      kind: 'FORBIDDEN_UNAVAILABLE'
    })
  })

  it('reconciles only state-changing password-change rejections', () => {
    expect(shouldReconcileAfterPasswordChangeRejection('ACCOUNT_INACTIVE')).toBe(true)
    expect(shouldReconcileAfterPasswordChangeRejection('PASSWORD_CHANGE_NOT_REQUIRED')).toBe(true)
    expect(shouldReconcileAfterPasswordChangeRejection('CURRENT_PASSWORD_INVALID')).toBe(false)
    expect(shouldReconcileAfterPasswordChangeRejection('NEW_PASSWORD_CONFIRMATION_MISMATCH')).toBe(
      false
    )
  })
})

function createController(): RendererAuthenticationRouteController & {
  reconcile: ReturnType<typeof vi.fn<RendererAuthenticationRouteController['reconcile']>>
  showUnavailable: ReturnType<
    typeof vi.fn<RendererAuthenticationRouteController['showUnavailable']>
  >
} {
  return {
    load: vi.fn(),
    reconcile: vi.fn(() => Promise.resolve()),
    acceptSession: vi.fn(),
    showUnavailable: vi.fn(),
    dispose: vi.fn()
  }
}
