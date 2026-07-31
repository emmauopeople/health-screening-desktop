import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type LocalForcedPasswordChangeErrorCode =
  | 'LOCAL_FORCED_PASSWORD_CHANGE_VALIDATION_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_UNAVAILABLE'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_STATE_INTEGRITY_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_CONCURRENCY_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_VERIFICATION_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_HASHING_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_PERSISTENCE_ERROR'
  | 'LOCAL_FORCED_PASSWORD_CHANGE_COMPOSITION_ERROR'

type LocalForcedPasswordChangeErrorName =
  | 'LocalForcedPasswordChangeValidationError'
  | 'LocalForcedPasswordChangeUnavailableError'
  | 'LocalForcedPasswordChangeStateIntegrityError'
  | 'LocalForcedPasswordChangeConcurrencyError'
  | 'LocalForcedPasswordChangeVerificationError'
  | 'LocalForcedPasswordChangeHashingError'
  | 'LocalForcedPasswordChangePersistenceError'
  | 'LocalForcedPasswordChangeCompositionError'

class ControlledLocalForcedPasswordChangeError extends Error {
  readonly code: LocalForcedPasswordChangeErrorCode
  readonly errorType?: string

  constructor(
    name: LocalForcedPasswordChangeErrorName,
    code: LocalForcedPasswordChangeErrorCode,
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

export class LocalForcedPasswordChangeValidationError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeValidationError',
      'LOCAL_FORCED_PASSWORD_CHANGE_VALIDATION_ERROR',
      'Forced password change command is invalid.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeUnavailableError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeUnavailableError',
      'LOCAL_FORCED_PASSWORD_CHANGE_UNAVAILABLE',
      'Forced password change is unavailable.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeStateIntegrityError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeStateIntegrityError',
      'LOCAL_FORCED_PASSWORD_CHANGE_STATE_INTEGRITY_ERROR',
      'Forced password change state is inconsistent.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeConcurrencyError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeConcurrencyError',
      'LOCAL_FORCED_PASSWORD_CHANGE_CONCURRENCY_ERROR',
      'Forced password change state changed before completion.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeVerificationError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeVerificationError',
      'LOCAL_FORCED_PASSWORD_CHANGE_VERIFICATION_ERROR',
      'Forced password change credential could not be verified.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeHashingError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeHashingError',
      'LOCAL_FORCED_PASSWORD_CHANGE_HASHING_ERROR',
      'Forced password change credential could not be created.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangePersistenceError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangePersistenceError',
      'LOCAL_FORCED_PASSWORD_CHANGE_PERSISTENCE_ERROR',
      'Forced password change outcome could not be persisted.',
      errorType
    )
  }
}

export class LocalForcedPasswordChangeCompositionError extends ControlledLocalForcedPasswordChangeError {
  constructor(errorType?: string) {
    super(
      'LocalForcedPasswordChangeCompositionError',
      'LOCAL_FORCED_PASSWORD_CHANGE_COMPOSITION_ERROR',
      'Forced password change service could not be composed.',
      errorType
    )
  }
}

export type LocalForcedPasswordChangeError =
  | LocalForcedPasswordChangeValidationError
  | LocalForcedPasswordChangeUnavailableError
  | LocalForcedPasswordChangeStateIntegrityError
  | LocalForcedPasswordChangeConcurrencyError
  | LocalForcedPasswordChangeVerificationError
  | LocalForcedPasswordChangeHashingError
  | LocalForcedPasswordChangePersistenceError
  | LocalForcedPasswordChangeCompositionError

export function isLocalForcedPasswordChangeError(
  error: unknown
): error is LocalForcedPasswordChangeError {
  return (
    error instanceof LocalForcedPasswordChangeValidationError ||
    error instanceof LocalForcedPasswordChangeUnavailableError ||
    error instanceof LocalForcedPasswordChangeStateIntegrityError ||
    error instanceof LocalForcedPasswordChangeConcurrencyError ||
    error instanceof LocalForcedPasswordChangeVerificationError ||
    error instanceof LocalForcedPasswordChangeHashingError ||
    error instanceof LocalForcedPasswordChangePersistenceError ||
    error instanceof LocalForcedPasswordChangeCompositionError
  )
}

export function rebuildLocalForcedPasswordChangeError(
  error: LocalForcedPasswordChangeError
): LocalForcedPasswordChangeError {
  if (error instanceof LocalForcedPasswordChangeValidationError) {
    return new LocalForcedPasswordChangeValidationError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangeUnavailableError) {
    return new LocalForcedPasswordChangeUnavailableError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangeStateIntegrityError) {
    return new LocalForcedPasswordChangeStateIntegrityError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangeConcurrencyError) {
    return new LocalForcedPasswordChangeConcurrencyError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangeVerificationError) {
    return new LocalForcedPasswordChangeVerificationError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangeHashingError) {
    return new LocalForcedPasswordChangeHashingError(error.errorType)
  }

  if (error instanceof LocalForcedPasswordChangePersistenceError) {
    return new LocalForcedPasswordChangePersistenceError(error.errorType)
  }

  return new LocalForcedPasswordChangeCompositionError(error.errorType)
}

export function getLocalForcedPasswordChangeErrorType(error: unknown): string {
  if (isLocalForcedPasswordChangeError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
