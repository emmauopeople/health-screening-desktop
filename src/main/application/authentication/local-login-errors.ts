import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type LocalLoginErrorCode =
  | 'LOCAL_LOGIN_VALIDATION_ERROR'
  | 'LOCAL_LOGIN_UNAVAILABLE'
  | 'LOCAL_LOGIN_STATE_INTEGRITY_ERROR'
  | 'LOCAL_LOGIN_CONCURRENCY_ERROR'
  | 'LOCAL_LOGIN_VERIFICATION_ERROR'
  | 'LOCAL_LOGIN_PERSISTENCE_ERROR'
  | 'LOCAL_LOGIN_COMPOSITION_ERROR'

type LocalLoginErrorName =
  | 'LocalLoginValidationError'
  | 'LocalLoginUnavailableError'
  | 'LocalLoginStateIntegrityError'
  | 'LocalLoginConcurrencyError'
  | 'LocalLoginVerificationError'
  | 'LocalLoginPersistenceError'
  | 'LocalLoginCompositionError'

class ControlledLocalLoginError extends Error {
  readonly code: LocalLoginErrorCode
  readonly errorType?: string

  constructor(
    name: LocalLoginErrorName,
    code: LocalLoginErrorCode,
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

export class LocalLoginValidationError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginValidationError',
      'LOCAL_LOGIN_VALIDATION_ERROR',
      'Local login command is invalid.',
      errorType
    )
  }
}

export class LocalLoginUnavailableError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginUnavailableError',
      'LOCAL_LOGIN_UNAVAILABLE',
      'Local login is unavailable.',
      errorType
    )
  }
}

export class LocalLoginStateIntegrityError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginStateIntegrityError',
      'LOCAL_LOGIN_STATE_INTEGRITY_ERROR',
      'Local login state is inconsistent.',
      errorType
    )
  }
}

export class LocalLoginConcurrencyError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginConcurrencyError',
      'LOCAL_LOGIN_CONCURRENCY_ERROR',
      'Local login state changed before completion.',
      errorType
    )
  }
}

export class LocalLoginVerificationError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginVerificationError',
      'LOCAL_LOGIN_VERIFICATION_ERROR',
      'Local login credential could not be verified.',
      errorType
    )
  }
}

export class LocalLoginPersistenceError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginPersistenceError',
      'LOCAL_LOGIN_PERSISTENCE_ERROR',
      'Local login outcome could not be persisted.',
      errorType
    )
  }
}

export class LocalLoginCompositionError extends ControlledLocalLoginError {
  constructor(errorType?: string) {
    super(
      'LocalLoginCompositionError',
      'LOCAL_LOGIN_COMPOSITION_ERROR',
      'Local login service could not be composed.',
      errorType
    )
  }
}

export type LocalLoginError =
  | LocalLoginValidationError
  | LocalLoginUnavailableError
  | LocalLoginStateIntegrityError
  | LocalLoginConcurrencyError
  | LocalLoginVerificationError
  | LocalLoginPersistenceError
  | LocalLoginCompositionError

export function isLocalLoginError(error: unknown): error is LocalLoginError {
  return (
    error instanceof LocalLoginValidationError ||
    error instanceof LocalLoginUnavailableError ||
    error instanceof LocalLoginStateIntegrityError ||
    error instanceof LocalLoginConcurrencyError ||
    error instanceof LocalLoginVerificationError ||
    error instanceof LocalLoginPersistenceError ||
    error instanceof LocalLoginCompositionError
  )
}

export function rebuildLocalLoginError(error: LocalLoginError): LocalLoginError {
  if (error instanceof LocalLoginValidationError) {
    return new LocalLoginValidationError(error.errorType)
  }

  if (error instanceof LocalLoginUnavailableError) {
    return new LocalLoginUnavailableError(error.errorType)
  }

  if (error instanceof LocalLoginStateIntegrityError) {
    return new LocalLoginStateIntegrityError(error.errorType)
  }

  if (error instanceof LocalLoginConcurrencyError) {
    return new LocalLoginConcurrencyError(error.errorType)
  }

  if (error instanceof LocalLoginVerificationError) {
    return new LocalLoginVerificationError(error.errorType)
  }

  if (error instanceof LocalLoginPersistenceError) {
    return new LocalLoginPersistenceError(error.errorType)
  }

  return new LocalLoginCompositionError(error.errorType)
}

export function getLocalLoginErrorType(error: unknown): string {
  if (isLocalLoginError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
