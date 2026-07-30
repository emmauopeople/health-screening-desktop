import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type FirstRunErrorCode =
  | 'FIRST_RUN_VALIDATION_ERROR'
  | 'FIRST_RUN_ALREADY_INITIALIZED'
  | 'FIRST_RUN_STATE_INTEGRITY_ERROR'
  | 'FIRST_RUN_INITIALIZATION_IN_PROGRESS'
  | 'FIRST_RUN_INITIALIZATION_ERROR'

type FirstRunErrorName =
  | 'FirstRunValidationError'
  | 'FirstRunAlreadyInitializedError'
  | 'FirstRunStateIntegrityError'
  | 'FirstRunInitializationInProgressError'
  | 'FirstRunInitializationError'

class ControlledFirstRunError extends Error {
  readonly code: FirstRunErrorCode
  readonly errorType?: string

  constructor(
    name: FirstRunErrorName,
    code: FirstRunErrorCode,
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

export class FirstRunValidationError extends ControlledFirstRunError {
  constructor(errorType?: string) {
    super(
      'FirstRunValidationError',
      'FIRST_RUN_VALIDATION_ERROR',
      'First-run setup input is invalid.',
      errorType
    )
  }
}

export class FirstRunAlreadyInitializedError extends ControlledFirstRunError {
  constructor(errorType?: string) {
    super(
      'FirstRunAlreadyInitializedError',
      'FIRST_RUN_ALREADY_INITIALIZED',
      'Application setup is already complete.',
      errorType
    )
  }
}

export class FirstRunStateIntegrityError extends ControlledFirstRunError {
  constructor(errorType?: string) {
    super(
      'FirstRunStateIntegrityError',
      'FIRST_RUN_STATE_INTEGRITY_ERROR',
      'Application setup state is inconsistent.',
      errorType
    )
  }
}

export class FirstRunInitializationInProgressError extends ControlledFirstRunError {
  constructor(errorType?: string) {
    super(
      'FirstRunInitializationInProgressError',
      'FIRST_RUN_INITIALIZATION_IN_PROGRESS',
      'Application setup is already in progress.',
      errorType
    )
  }
}

export class FirstRunInitializationError extends ControlledFirstRunError {
  constructor(errorType?: string) {
    super(
      'FirstRunInitializationError',
      'FIRST_RUN_INITIALIZATION_ERROR',
      'Application setup could not be completed.',
      errorType
    )
  }
}

export type FirstRunError =
  | FirstRunValidationError
  | FirstRunAlreadyInitializedError
  | FirstRunStateIntegrityError
  | FirstRunInitializationInProgressError
  | FirstRunInitializationError

export function isFirstRunError(error: unknown): error is FirstRunError {
  return (
    error instanceof FirstRunValidationError ||
    error instanceof FirstRunAlreadyInitializedError ||
    error instanceof FirstRunStateIntegrityError ||
    error instanceof FirstRunInitializationInProgressError ||
    error instanceof FirstRunInitializationError
  )
}

export function rebuildFirstRunError(error: FirstRunError): FirstRunError {
  if (error instanceof FirstRunValidationError) {
    return new FirstRunValidationError(error.errorType)
  }

  if (error instanceof FirstRunAlreadyInitializedError) {
    return new FirstRunAlreadyInitializedError(error.errorType)
  }

  if (error instanceof FirstRunStateIntegrityError) {
    return new FirstRunStateIntegrityError(error.errorType)
  }

  if (error instanceof FirstRunInitializationInProgressError) {
    return new FirstRunInitializationInProgressError(error.errorType)
  }

  return new FirstRunInitializationError(error.errorType)
}

export function getFirstRunErrorType(error: unknown): string {
  if (isFirstRunError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
