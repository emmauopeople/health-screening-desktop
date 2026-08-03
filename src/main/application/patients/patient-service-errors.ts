import { getErrorType, sanitizeErrorType } from '@main/foundation/error-type'

export type PatientRegistryErrorCode =
  'PATIENT_VALIDATION' | 'PATIENT_NOT_FOUND' | 'PATIENT_STATE_INTEGRITY' | 'PATIENT_CREATION_FAILED'

type PatientRegistryErrorName =
  | 'PatientRegistryValidationError'
  | 'PatientRegistryNotFoundError'
  | 'PatientRegistryStateIntegrityError'
  | 'PatientRegistryCreationError'

class ControlledPatientRegistryError extends Error {
  readonly code: PatientRegistryErrorCode
  readonly errorType?: string

  constructor(
    name: PatientRegistryErrorName,
    code: PatientRegistryErrorCode,
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

export class PatientRegistryValidationError extends ControlledPatientRegistryError {
  constructor(errorType?: string) {
    super(
      'PatientRegistryValidationError',
      'PATIENT_VALIDATION',
      'Patient registry request failed validation.',
      errorType
    )
  }
}

export class PatientRegistryNotFoundError extends ControlledPatientRegistryError {
  constructor(errorType?: string) {
    super('PatientRegistryNotFoundError', 'PATIENT_NOT_FOUND', 'Patient was not found.', errorType)
  }
}

export class PatientRegistryStateIntegrityError extends ControlledPatientRegistryError {
  constructor(errorType?: string) {
    super(
      'PatientRegistryStateIntegrityError',
      'PATIENT_STATE_INTEGRITY',
      'Patient registry state is inconsistent.',
      errorType
    )
  }
}

export class PatientRegistryCreationError extends ControlledPatientRegistryError {
  constructor(errorType?: string) {
    super(
      'PatientRegistryCreationError',
      'PATIENT_CREATION_FAILED',
      'Patient could not be created.',
      errorType
    )
  }
}

export type PatientRegistryError =
  | PatientRegistryValidationError
  | PatientRegistryNotFoundError
  | PatientRegistryStateIntegrityError
  | PatientRegistryCreationError

export function isPatientRegistryError(error: unknown): error is PatientRegistryError {
  return (
    error instanceof PatientRegistryValidationError ||
    error instanceof PatientRegistryNotFoundError ||
    error instanceof PatientRegistryStateIntegrityError ||
    error instanceof PatientRegistryCreationError
  )
}

export function rebuildPatientRegistryError(error: PatientRegistryError): PatientRegistryError {
  if (error instanceof PatientRegistryValidationError) {
    return new PatientRegistryValidationError(error.errorType)
  }

  if (error instanceof PatientRegistryNotFoundError) {
    return new PatientRegistryNotFoundError(error.errorType)
  }

  if (error instanceof PatientRegistryStateIntegrityError) {
    return new PatientRegistryStateIntegrityError(error.errorType)
  }

  return new PatientRegistryCreationError(error.errorType)
}

export function getPatientRegistryErrorType(error: unknown): string {
  if (isPatientRegistryError(error) && error.errorType !== undefined) {
    return sanitizeErrorType(error.errorType) ?? 'UnknownError'
  }

  return getErrorType(error)
}
