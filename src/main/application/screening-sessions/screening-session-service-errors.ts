import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type ScreeningSessionServiceErrorCode =
  | 'SCREENING_SESSION_SERVICE_VALIDATION_ERROR'
  | 'SCREENING_SESSION_SERVICE_AUTHORIZATION_ERROR'
  | 'SCREENING_SESSION_SERVICE_STATE_INTEGRITY_ERROR'
  | 'SCREENING_SESSION_SERVICE_PERSISTENCE_ERROR'

type ScreeningSessionServiceErrorName =
  | 'ScreeningSessionServiceValidationError'
  | 'ScreeningSessionServiceAuthorizationError'
  | 'ScreeningSessionServiceStateIntegrityError'
  | 'ScreeningSessionServicePersistenceError'

class ControlledScreeningSessionServiceError extends Error {
  readonly code: ScreeningSessionServiceErrorCode
  readonly errorType?: string

  constructor(
    name: ScreeningSessionServiceErrorName,
    code: ScreeningSessionServiceErrorCode,
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

export class ScreeningSessionServiceValidationError extends ControlledScreeningSessionServiceError {
  constructor(errorType?: string) {
    super(
      'ScreeningSessionServiceValidationError',
      'SCREENING_SESSION_SERVICE_VALIDATION_ERROR',
      'Screening session service input is invalid.',
      errorType
    )
  }
}

export class ScreeningSessionServiceAuthorizationError extends ControlledScreeningSessionServiceError {
  constructor(errorType?: string) {
    super(
      'ScreeningSessionServiceAuthorizationError',
      'SCREENING_SESSION_SERVICE_AUTHORIZATION_ERROR',
      'Screening session service action is not authorized.',
      errorType
    )
  }
}

export class ScreeningSessionServiceStateIntegrityError extends ControlledScreeningSessionServiceError {
  constructor(errorType?: string) {
    super(
      'ScreeningSessionServiceStateIntegrityError',
      'SCREENING_SESSION_SERVICE_STATE_INTEGRITY_ERROR',
      'Screening session service state is inconsistent.',
      errorType
    )
  }
}

export class ScreeningSessionServicePersistenceError extends ControlledScreeningSessionServiceError {
  constructor(errorType?: string) {
    super(
      'ScreeningSessionServicePersistenceError',
      'SCREENING_SESSION_SERVICE_PERSISTENCE_ERROR',
      'Screening session service change could not be persisted.',
      errorType
    )
  }
}

export type ScreeningSessionServiceError =
  | ScreeningSessionServiceValidationError
  | ScreeningSessionServiceAuthorizationError
  | ScreeningSessionServiceStateIntegrityError
  | ScreeningSessionServicePersistenceError

export function isScreeningSessionServiceError(
  error: unknown
): error is ScreeningSessionServiceError {
  return (
    error instanceof ScreeningSessionServiceValidationError ||
    error instanceof ScreeningSessionServiceAuthorizationError ||
    error instanceof ScreeningSessionServiceStateIntegrityError ||
    error instanceof ScreeningSessionServicePersistenceError
  )
}

export function rebuildScreeningSessionServiceError(
  error: ScreeningSessionServiceError
): ScreeningSessionServiceError {
  if (error instanceof ScreeningSessionServiceValidationError) {
    return new ScreeningSessionServiceValidationError(error.errorType)
  }

  if (error instanceof ScreeningSessionServiceAuthorizationError) {
    return new ScreeningSessionServiceAuthorizationError(error.errorType)
  }

  if (error instanceof ScreeningSessionServiceStateIntegrityError) {
    return new ScreeningSessionServiceStateIntegrityError(error.errorType)
  }

  return new ScreeningSessionServicePersistenceError(error.errorType)
}

export function getScreeningSessionServiceErrorType(error: unknown): string {
  if (isScreeningSessionServiceError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
