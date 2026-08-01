import { describe, expect, it } from 'vitest'

import {
  authenticationUiMessages,
  isForbiddenAuthenticationFailure,
  mapAuthenticationFailureMessage,
  mapLoginRejectionMessage,
  mapPasswordChangeRejectionMessage,
  shouldReconcileAfterAuthenticationFailure
} from '../../../src/renderer/src/app/authentication/authentication-message-mapping'

describe('authentication message mapping', () => {
  it('maps expected credential rejections to fixed renderer copy', () => {
    expect(mapLoginRejectionMessage({ reason: 'INVALID_CREDENTIALS', retryAt: null })).toBe(
      authenticationUiMessages.loginInvalidCredentials
    )
    expect(mapLoginRejectionMessage({ reason: 'ACCOUNT_INACTIVE', retryAt: null })).toBe(
      authenticationUiMessages.accountInactive
    )
    expect(
      mapLoginRejectionMessage({
        reason: 'ACCOUNT_LOCKED',
        retryAt: '2026-07-31T12:15:00.000Z' as never
      })
    ).toContain(authenticationUiMessages.accountLocked)

    expect(
      mapPasswordChangeRejectionMessage({
        reason: 'PASSWORD_CHANGE_NOT_REQUIRED',
        retryAt: null
      })
    ).toBe(authenticationUiMessages.passwordChangeNotRequired)
    expect(
      mapPasswordChangeRejectionMessage({
        reason: 'NEW_PASSWORD_CONFIRMATION_MISMATCH',
        retryAt: null
      })
    ).toBe(authenticationUiMessages.newPasswordMismatch)
  })

  it('maps controlled failures without exposing raw errors', () => {
    expect(mapAuthenticationFailureMessage('VALIDATION_FAILED')).toBe(
      authenticationUiMessages.validationFailed
    )
    expect(mapAuthenticationFailureMessage('IPC_FORBIDDEN')).toBe(
      authenticationUiMessages.forbidden
    )
    expect(mapAuthenticationFailureMessage('INTERNAL_ERROR')).toBe(authenticationUiMessages.generic)
    expect(mapAuthenticationFailureMessage('AUTH_CONCURRENCY')).toBe(
      authenticationUiMessages.sessionChanged
    )
  })

  it('identifies failures that require session reconciliation', () => {
    expect(shouldReconcileAfterAuthenticationFailure('AUTH_UNAUTHENTICATED')).toBe(true)
    expect(shouldReconcileAfterAuthenticationFailure('AUTH_LOCKED')).toBe(true)
    expect(shouldReconcileAfterAuthenticationFailure('AUTH_PASSWORD_CHANGE_REQUIRED')).toBe(true)
    expect(shouldReconcileAfterAuthenticationFailure('AUTH_CONCURRENCY')).toBe(true)
    expect(shouldReconcileAfterAuthenticationFailure('AUTH_STATE_INTEGRITY')).toBe(true)
    expect(shouldReconcileAfterAuthenticationFailure('IPC_UNAVAILABLE')).toBe(false)
    expect(isForbiddenAuthenticationFailure('IPC_FORBIDDEN')).toBe(true)
  })
})
