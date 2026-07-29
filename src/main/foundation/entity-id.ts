import { randomUUID } from 'node:crypto'

export type EntityId = string & { readonly __brand: 'EntityId' }

export interface EntityIdGenerator {
  generate(): EntityId
}

export type EntityIdProvider = () => string

const canonicalUuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function parseEntityId(value: unknown): EntityId {
  if (typeof value !== 'string' || !canonicalUuidV4Pattern.test(value)) {
    throw new EntityIdGenerationError()
  }

  return value as EntityId
}

export function createEntityIdGenerator(provider: EntityIdProvider): EntityIdGenerator {
  return {
    generate(): EntityId {
      try {
        return parseEntityId(provider())
      } catch (error) {
        if (error instanceof EntityIdGenerationError) {
          throw error
        }

        throw new EntityIdGenerationError(getErrorType(error))
      }
    }
  }
}

export function createSystemEntityIdGenerator(
  provider: EntityIdProvider = randomUUID
): EntityIdGenerator {
  return createEntityIdGenerator(provider)
}

export class EntityIdGenerationError extends Error {
  readonly errorType?: string

  constructor(errorType?: string) {
    super('Entity identifier could not be generated.')
    this.name = 'EntityIdGenerationError'
    this.errorType = sanitizeErrorType(errorType)
    this.stack = undefined
  }
}

function getErrorType(error: unknown): string {
  return sanitizeErrorType(error instanceof Error ? error.name : typeof error) ?? 'UnknownError'
}

function sanitizeErrorType(errorType: string | undefined): string | undefined {
  if (errorType === undefined) {
    return undefined
  }

  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorType) ? errorType : 'UnknownError'
}
