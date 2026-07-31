import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type LocalSessionErrorCode =
  | 'LOCAL_SESSION_VALIDATION_ERROR'
  | 'LOCAL_SESSION_STATE_INTEGRITY_ERROR'
  | 'LOCAL_SESSION_OPERATION_IN_PROGRESS'
  | 'LOCAL_SESSION_CONCURRENCY_ERROR'
  | 'LOCAL_SESSION_UNAUTHENTICATED'
  | 'LOCAL_SESSION_LOCKED'
  | 'LOCAL_SESSION_PASSWORD_CHANGE_REQUIRED'
  | 'LOCAL_SESSION_AUTHORIZATION_ERROR'
  | 'LOCAL_SESSION_AUTHENTICATION_ERROR'
  | 'LOCAL_SESSION_COMPOSITION_ERROR'

type LocalSessionErrorName =
  | 'LocalSessionValidationError'
  | 'LocalSessionStateIntegrityError'
  | 'LocalSessionOperationInProgressError'
  | 'LocalSessionConcurrencyError'
  | 'LocalSessionUnauthenticatedError'
  | 'LocalSessionLockedError'
  | 'LocalSessionPasswordChangeRequiredError'
  | 'LocalSessionAuthorizationError'
  | 'LocalSessionAuthenticationError'
  | 'LocalSessionCompositionError'

class ControlledLocalSessionError extends Error {
  readonly code: LocalSessionErrorCode
  readonly errorType?: string

  constructor(
    name: LocalSessionErrorName,
    code: LocalSessionErrorCode,
    message: string,
    errorType?: string
  ) {
    super(message)
    this.name = name
    this.code = code
    this.errorType = sanitizeErrorType(errorType)
    delete this.stack
  }
}

export class LocalSessionValidationError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionValidationError',
      'LOCAL_SESSION_VALIDATION_ERROR',
      'Local session command is invalid.',
      errorType
    )
  }
}

export class LocalSessionStateIntegrityError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionStateIntegrityError',
      'LOCAL_SESSION_STATE_INTEGRITY_ERROR',
      'Local session state is inconsistent.',
      errorType
    )
  }
}

export class LocalSessionOperationInProgressError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionOperationInProgressError',
      'LOCAL_SESSION_OPERATION_IN_PROGRESS',
      'Local session authentication operation is already in progress.',
      errorType
    )
  }
}

export class LocalSessionConcurrencyError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionConcurrencyError',
      'LOCAL_SESSION_CONCURRENCY_ERROR',
      'Local session state changed before completion.',
      errorType
    )
  }
}

export class LocalSessionUnauthenticatedError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionUnauthenticatedError',
      'LOCAL_SESSION_UNAUTHENTICATED',
      'An active local session is required.',
      errorType
    )
  }
}

export class LocalSessionLockedError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionLockedError',
      'LOCAL_SESSION_LOCKED',
      'The local session is locked.',
      errorType
    )
  }
}

export class LocalSessionPasswordChangeRequiredError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionPasswordChangeRequiredError',
      'LOCAL_SESSION_PASSWORD_CHANGE_REQUIRED',
      'A required password change must be completed before this operation.',
      errorType
    )
  }
}

export class LocalSessionAuthorizationError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionAuthorizationError',
      'LOCAL_SESSION_AUTHORIZATION_ERROR',
      'The active local session is not authorized for this operation.',
      errorType
    )
  }
}

export class LocalSessionAuthenticationError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionAuthenticationError',
      'LOCAL_SESSION_AUTHENTICATION_ERROR',
      'Local session authentication could not be completed.',
      errorType
    )
  }
}

export class LocalSessionCompositionError extends ControlledLocalSessionError {
  constructor(errorType?: string) {
    super(
      'LocalSessionCompositionError',
      'LOCAL_SESSION_COMPOSITION_ERROR',
      'Local session service could not be composed.',
      errorType
    )
  }
}

export type LocalSessionError =
  | LocalSessionValidationError
  | LocalSessionStateIntegrityError
  | LocalSessionOperationInProgressError
  | LocalSessionConcurrencyError
  | LocalSessionUnauthenticatedError
  | LocalSessionLockedError
  | LocalSessionPasswordChangeRequiredError
  | LocalSessionAuthorizationError
  | LocalSessionAuthenticationError
  | LocalSessionCompositionError

export function isLocalSessionError(error: unknown): error is LocalSessionError {
  return (
    error instanceof LocalSessionValidationError ||
    error instanceof LocalSessionStateIntegrityError ||
    error instanceof LocalSessionOperationInProgressError ||
    error instanceof LocalSessionConcurrencyError ||
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError ||
    error instanceof LocalSessionAuthorizationError ||
    error instanceof LocalSessionAuthenticationError ||
    error instanceof LocalSessionCompositionError
  )
}

export function rebuildLocalSessionError(error: LocalSessionError): LocalSessionError {
  if (error instanceof LocalSessionValidationError) {
    return new LocalSessionValidationError(error.errorType)
  }

  if (error instanceof LocalSessionStateIntegrityError) {
    return new LocalSessionStateIntegrityError(error.errorType)
  }

  if (error instanceof LocalSessionOperationInProgressError) {
    return new LocalSessionOperationInProgressError(error.errorType)
  }

  if (error instanceof LocalSessionConcurrencyError) {
    return new LocalSessionConcurrencyError(error.errorType)
  }

  if (error instanceof LocalSessionUnauthenticatedError) {
    return new LocalSessionUnauthenticatedError(error.errorType)
  }

  if (error instanceof LocalSessionLockedError) {
    return new LocalSessionLockedError(error.errorType)
  }

  if (error instanceof LocalSessionPasswordChangeRequiredError) {
    return new LocalSessionPasswordChangeRequiredError(error.errorType)
  }

  if (error instanceof LocalSessionAuthorizationError) {
    return new LocalSessionAuthorizationError(error.errorType)
  }

  if (error instanceof LocalSessionAuthenticationError) {
    return new LocalSessionAuthenticationError(error.errorType)
  }

  return new LocalSessionCompositionError(error.errorType)
}

export function getLocalSessionErrorType(error: unknown): string {
  if (isLocalSessionError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
