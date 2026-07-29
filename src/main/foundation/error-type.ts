const reviewedErrorTypes = new Set<string>([
  'Error',
  'TypeError',
  'RangeError',
  'SqliteError',
  'EntityIdGenerationError',
  'UtcClockError',
  'DatabaseTransactionStateError',
  'DatabaseTransactionAsyncWorkError',
  'DatabaseTransactionExecutionError',
  'UnknownError'
])

export function sanitizeErrorType(errorType: string | undefined): string | undefined {
  if (errorType === undefined) {
    return undefined
  }

  return reviewedErrorTypes.has(errorType) ? errorType : 'UnknownError'
}

export function getErrorType(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorType(error.name) ?? 'UnknownError'
  }

  return sanitizeErrorType(typeof error) ?? 'UnknownError'
}
