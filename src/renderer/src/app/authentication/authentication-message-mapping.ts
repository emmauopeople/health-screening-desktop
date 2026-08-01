import type {
  AuthenticationErrorCode,
  AuthForcedPasswordChangeRejectionReason,
  AuthLoginRejectionReason,
  UtcTimestamp
} from '@shared/ipc'

export const authenticationUiMessages = {
  loginInvalidCredentials: 'The username or password is incorrect.',
  accountInactive: 'This account is inactive. Contact the local administrator.',
  accountLocked: 'This account is temporarily locked.',
  currentPasswordInvalid: 'The current password is incorrect.',
  passwordChangeNotRequired:
    'The password-change requirement is no longer current. Refreshing the session.',
  newPasswordReusesCurrent: 'Choose a new password that is different from the current password.',
  newPasswordMismatch: 'The new passwords do not match.',
  validationFailed: 'Review the form and correct missing or invalid values.',
  operationInProgress: 'Another authentication action is already in progress. Wait a moment.',
  sessionChanged: 'The local session changed. Refreshing the session.',
  unavailable: 'The desktop authentication service is unavailable. Try again after it is ready.',
  forbidden: 'Authentication is unavailable from the current window.',
  generic: 'The application could not complete the authentication action.',
  stateIntegrity:
    'Authentication is unavailable because the local session state could not be verified.',
  unauthenticated: 'The session is signed out. Refreshing the session.',
  locked: 'The session is locked. Refreshing the session.',
  passwordChangeRequired: 'A required password change must be completed. Refreshing the session.'
} as const

export function mapLoginRejectionMessage({
  reason,
  retryAt
}: {
  readonly reason: AuthLoginRejectionReason
  readonly retryAt: UtcTimestamp | null
}): string {
  if (reason === 'INVALID_CREDENTIALS') {
    return authenticationUiMessages.loginInvalidCredentials
  }

  if (reason === 'ACCOUNT_INACTIVE') {
    return authenticationUiMessages.accountInactive
  }

  return withRetryAt(authenticationUiMessages.accountLocked, retryAt)
}

export function mapPasswordChangeRejectionMessage({
  reason,
  retryAt
}: {
  readonly reason: AuthForcedPasswordChangeRejectionReason
  readonly retryAt: UtcTimestamp | null
}): string {
  switch (reason) {
    case 'CURRENT_PASSWORD_INVALID':
      return authenticationUiMessages.currentPasswordInvalid
    case 'ACCOUNT_INACTIVE':
      return authenticationUiMessages.accountInactive
    case 'ACCOUNT_LOCKED':
      return withRetryAt(authenticationUiMessages.accountLocked, retryAt)
    case 'PASSWORD_CHANGE_NOT_REQUIRED':
      return authenticationUiMessages.passwordChangeNotRequired
    case 'NEW_PASSWORD_REUSES_CURRENT_PASSWORD':
      return authenticationUiMessages.newPasswordReusesCurrent
    case 'NEW_PASSWORD_CONFIRMATION_MISMATCH':
      return authenticationUiMessages.newPasswordMismatch
  }
}

export function mapAuthenticationFailureMessage(code: AuthenticationErrorCode): string {
  switch (code) {
    case 'VALIDATION_FAILED':
      return authenticationUiMessages.validationFailed
    case 'AUTH_OPERATION_IN_PROGRESS':
      return authenticationUiMessages.operationInProgress
    case 'AUTH_UNAUTHENTICATED':
      return authenticationUiMessages.unauthenticated
    case 'AUTH_LOCKED':
      return authenticationUiMessages.locked
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return authenticationUiMessages.passwordChangeRequired
    case 'AUTH_CONCURRENCY':
      return authenticationUiMessages.sessionChanged
    case 'AUTH_STATE_INTEGRITY':
      return authenticationUiMessages.stateIntegrity
    case 'IPC_UNAVAILABLE':
    case 'AUTHENTICATION_UNAVAILABLE':
      return authenticationUiMessages.unavailable
    case 'IPC_FORBIDDEN':
      return authenticationUiMessages.forbidden
    case 'INTERNAL_ERROR':
    case 'AUTHORIZATION_FAILED':
      return authenticationUiMessages.generic
  }
}

export function shouldReconcileAfterAuthenticationFailure(code: AuthenticationErrorCode): boolean {
  return (
    code === 'AUTH_UNAUTHENTICATED' ||
    code === 'AUTH_LOCKED' ||
    code === 'AUTH_PASSWORD_CHANGE_REQUIRED' ||
    code === 'AUTH_CONCURRENCY' ||
    code === 'AUTH_STATE_INTEGRITY'
  )
}

export function isForbiddenAuthenticationFailure(code: AuthenticationErrorCode): boolean {
  return code === 'IPC_FORBIDDEN'
}

function withRetryAt(message: string, retryAt: UtcTimestamp | null): string {
  if (retryAt === null) {
    return message
  }

  return `${message} Try again after ${formatRetryTime(retryAt)}.`
}

function formatRetryTime(retryAt: UtcTimestamp): string {
  const date = new Date(retryAt)

  if (!Number.isFinite(date.getTime())) {
    return 'the safe retry time'
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
