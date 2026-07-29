import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type PasswordCredentialErrorCode =
  | 'PASSWORD_VALIDATION_ERROR'
  | 'PASSWORD_CREDENTIAL_FORMAT_ERROR'
  | 'PASSWORD_HASHING_ERROR'
  | 'PASSWORD_VERIFICATION_ERROR'

type PasswordCredentialErrorName =
  | 'PasswordValidationError'
  | 'PasswordCredentialFormatError'
  | 'PasswordHashingError'
  | 'PasswordVerificationError'

class ControlledPasswordCredentialError extends Error {
  readonly code: PasswordCredentialErrorCode
  readonly errorType?: string

  constructor(
    name: PasswordCredentialErrorName,
    code: PasswordCredentialErrorCode,
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

export class PasswordValidationError extends ControlledPasswordCredentialError {
  constructor(errorType?: string) {
    super(
      'PasswordValidationError',
      'PASSWORD_VALIDATION_ERROR',
      'Password input failed validation.',
      errorType
    )
  }
}

export class PasswordCredentialFormatError extends ControlledPasswordCredentialError {
  constructor(errorType?: string) {
    super(
      'PasswordCredentialFormatError',
      'PASSWORD_CREDENTIAL_FORMAT_ERROR',
      'Password credential format is not supported.',
      errorType
    )
  }
}

export class PasswordHashingError extends ControlledPasswordCredentialError {
  constructor(errorType?: string) {
    super(
      'PasswordHashingError',
      'PASSWORD_HASHING_ERROR',
      'Password credential could not be created.',
      errorType
    )
  }
}

export class PasswordVerificationError extends ControlledPasswordCredentialError {
  constructor(errorType?: string) {
    super(
      'PasswordVerificationError',
      'PASSWORD_VERIFICATION_ERROR',
      'Password credential could not be verified.',
      errorType
    )
  }
}

export type PasswordCredentialError =
  | PasswordValidationError
  | PasswordCredentialFormatError
  | PasswordHashingError
  | PasswordVerificationError

export function isPasswordCredentialError(error: unknown): error is PasswordCredentialError {
  return (
    error instanceof PasswordValidationError ||
    error instanceof PasswordCredentialFormatError ||
    error instanceof PasswordHashingError ||
    error instanceof PasswordVerificationError
  )
}

export function rebuildPasswordCredentialError(
  error: PasswordCredentialError
): PasswordCredentialError {
  if (error instanceof PasswordValidationError) {
    return new PasswordValidationError(error.errorType)
  }

  if (error instanceof PasswordCredentialFormatError) {
    return new PasswordCredentialFormatError(error.errorType)
  }

  if (error instanceof PasswordHashingError) {
    return new PasswordHashingError(error.errorType)
  }

  return new PasswordVerificationError(error.errorType)
}

export function getPasswordCredentialErrorType(error: unknown): string {
  if (isPasswordCredentialError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
