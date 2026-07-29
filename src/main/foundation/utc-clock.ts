import { getErrorType, sanitizeErrorType } from './error-type'

export type UtcTimestamp = string & { readonly __brand: 'UtcTimestamp' }

export interface UtcClock {
  now(): UtcTimestamp
}

export type DateProvider = () => Date
export type UtcTimestampProvider = () => string

const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function parseUtcTimestamp(value: unknown): UtcTimestamp {
  if (typeof value !== 'string' || !utcTimestampPattern.test(value)) {
    throw new UtcClockError()
  }

  const parsed = new Date(value)

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new UtcClockError()
  }

  return value as UtcTimestamp
}

export function createUtcClock(provider: UtcTimestampProvider): UtcClock {
  return {
    now(): UtcTimestamp {
      try {
        return parseUtcTimestamp(provider())
      } catch (error) {
        if (error instanceof UtcClockError) {
          throw new UtcClockError(error.errorType)
        }

        throw new UtcClockError(getErrorType(error))
      }
    }
  }
}

export function createSystemUtcClock(dateProvider: DateProvider = () => new Date()): UtcClock {
  return createUtcClock(() => {
    try {
      return dateProvider().toISOString()
    } catch (error) {
      throw new UtcClockError(getErrorType(error))
    }
  })
}

export class UtcClockError extends Error {
  readonly errorType?: string

  constructor(errorType?: string) {
    super('UTC timestamp could not be produced.')
    this.name = 'UtcClockError'
    this.errorType = sanitizeErrorType(errorType)
    delete this.stack
  }
}
