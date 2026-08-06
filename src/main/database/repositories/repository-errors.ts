import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type RepositoryErrorCode =
  | 'REPOSITORY_VALIDATION_ERROR'
  | 'REPOSITORY_READ_ERROR'
  | 'REPOSITORY_WRITE_ERROR'
  | 'REPOSITORY_DATA_INTEGRITY_ERROR'
  | 'INSTALLATION_ALREADY_EXISTS'
  | 'LOCAL_USER_ALREADY_EXISTS'
  | 'LOCAL_USER_NOT_FOUND'
  | 'LOCAL_USER_AUTHENTICATION_STATE_CONFLICT'
  | 'LOCAL_USER_CREDENTIAL_STATE_CONFLICT'
  | 'LOCATION_ALREADY_EXISTS'
  | 'SCREENING_SESSION_ALREADY_EXISTS'
  | 'AUDIT_EVENT_ALREADY_EXISTS'

type RepositoryErrorName =
  | 'RepositoryValidationError'
  | 'RepositoryReadError'
  | 'RepositoryWriteError'
  | 'RepositoryDataIntegrityError'
  | 'InstallationAlreadyExistsError'
  | 'LocalUserAlreadyExistsError'
  | 'LocalUserNotFoundError'
  | 'LocalUserAuthenticationStateConflictError'
  | 'LocalUserCredentialStateConflictError'
  | 'LocationAlreadyExistsError'
  | 'ScreeningSessionAlreadyExistsError'
  | 'AuditEventAlreadyExistsError'

class ControlledRepositoryError extends Error {
  readonly code: RepositoryErrorCode
  readonly errorType?: string

  constructor(
    name: RepositoryErrorName,
    code: RepositoryErrorCode,
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

export class RepositoryValidationError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'RepositoryValidationError',
      'REPOSITORY_VALIDATION_ERROR',
      'Repository input or row value failed validation.',
      errorType
    )
  }
}

export class RepositoryReadError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'RepositoryReadError',
      'REPOSITORY_READ_ERROR',
      'Repository read could not be completed.',
      errorType
    )
  }
}

export class RepositoryWriteError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'RepositoryWriteError',
      'REPOSITORY_WRITE_ERROR',
      'Repository write could not be completed.',
      errorType
    )
  }
}

export class RepositoryDataIntegrityError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'RepositoryDataIntegrityError',
      'REPOSITORY_DATA_INTEGRITY_ERROR',
      'Repository data does not match the trusted contract.',
      errorType
    )
  }
}

export class InstallationAlreadyExistsError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'InstallationAlreadyExistsError',
      'INSTALLATION_ALREADY_EXISTS',
      'Installation already exists.',
      errorType
    )
  }
}

export class LocalUserAlreadyExistsError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'LocalUserAlreadyExistsError',
      'LOCAL_USER_ALREADY_EXISTS',
      'Local user already exists.',
      errorType
    )
  }
}

export class LocalUserNotFoundError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super('LocalUserNotFoundError', 'LOCAL_USER_NOT_FOUND', 'Local user was not found.', errorType)
  }
}

export class LocalUserAuthenticationStateConflictError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'LocalUserAuthenticationStateConflictError',
      'LOCAL_USER_AUTHENTICATION_STATE_CONFLICT',
      'Local user authentication state no longer matches the expected state.',
      errorType
    )
  }
}

export class LocalUserCredentialStateConflictError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'LocalUserCredentialStateConflictError',
      'LOCAL_USER_CREDENTIAL_STATE_CONFLICT',
      'Local user credential state no longer matches the expected state.',
      errorType
    )
  }
}

export class LocationAlreadyExistsError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'LocationAlreadyExistsError',
      'LOCATION_ALREADY_EXISTS',
      'Location already exists.',
      errorType
    )
  }
}

export class ScreeningSessionAlreadyExistsError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'ScreeningSessionAlreadyExistsError',
      'SCREENING_SESSION_ALREADY_EXISTS',
      'Screening session already exists.',
      errorType
    )
  }
}

export class AuditEventAlreadyExistsError extends ControlledRepositoryError {
  constructor(errorType?: string) {
    super(
      'AuditEventAlreadyExistsError',
      'AUDIT_EVENT_ALREADY_EXISTS',
      'Audit event already exists.',
      errorType
    )
  }
}

export type RepositoryError =
  | RepositoryValidationError
  | RepositoryReadError
  | RepositoryWriteError
  | RepositoryDataIntegrityError
  | InstallationAlreadyExistsError
  | LocalUserAlreadyExistsError
  | LocalUserNotFoundError
  | LocalUserAuthenticationStateConflictError
  | LocalUserCredentialStateConflictError
  | LocationAlreadyExistsError
  | ScreeningSessionAlreadyExistsError
  | AuditEventAlreadyExistsError

export function isRepositoryError(error: unknown): error is RepositoryError {
  return (
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryReadError ||
    error instanceof RepositoryWriteError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof InstallationAlreadyExistsError ||
    error instanceof LocalUserAlreadyExistsError ||
    error instanceof LocalUserNotFoundError ||
    error instanceof LocalUserAuthenticationStateConflictError ||
    error instanceof LocalUserCredentialStateConflictError ||
    error instanceof LocationAlreadyExistsError ||
    error instanceof ScreeningSessionAlreadyExistsError ||
    error instanceof AuditEventAlreadyExistsError
  )
}

export function rebuildRepositoryError(error: RepositoryError): RepositoryError {
  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
  }

  if (error instanceof RepositoryReadError) {
    return new RepositoryReadError(error.errorType)
  }

  if (error instanceof RepositoryWriteError) {
    return new RepositoryWriteError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }

  if (error instanceof InstallationAlreadyExistsError) {
    return new InstallationAlreadyExistsError(error.errorType)
  }

  if (error instanceof LocalUserAlreadyExistsError) {
    return new LocalUserAlreadyExistsError(error.errorType)
  }

  if (error instanceof LocalUserNotFoundError) {
    return new LocalUserNotFoundError(error.errorType)
  }

  if (error instanceof LocalUserAuthenticationStateConflictError) {
    return new LocalUserAuthenticationStateConflictError(error.errorType)
  }

  if (error instanceof LocalUserCredentialStateConflictError) {
    return new LocalUserCredentialStateConflictError(error.errorType)
  }

  if (error instanceof LocationAlreadyExistsError) {
    return new LocationAlreadyExistsError(error.errorType)
  }

  if (error instanceof ScreeningSessionAlreadyExistsError) {
    return new ScreeningSessionAlreadyExistsError(error.errorType)
  }

  return new AuditEventAlreadyExistsError(error.errorType)
}

export function getRepositoryErrorType(error: unknown): string {
  if (isRepositoryError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
