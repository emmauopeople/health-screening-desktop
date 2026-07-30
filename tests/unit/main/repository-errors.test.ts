import { describe, expect, it } from 'vitest'

import {
  AuditEventAlreadyExistsError,
  InstallationAlreadyExistsError,
  LocationAlreadyExistsError,
  LocalUserAlreadyExistsError,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '@main/database'
import {
  isRepositoryError,
  rebuildRepositoryError,
  type RepositoryError
} from '@main/database/repositories/repository-errors'

describe('repository errors', () => {
  it('uses fixed safe codes, messages, and serialization shape', () => {
    const errors: readonly RepositoryError[] = [
      new RepositoryValidationError('TypeError'),
      new RepositoryReadError('SqliteError'),
      new RepositoryWriteError('Error'),
      new RepositoryDataIntegrityError('RepositoryValidationError'),
      new InstallationAlreadyExistsError('InstallationAlreadyExistsError'),
      new LocalUserAlreadyExistsError('LocalUserAlreadyExistsError'),
      new LocationAlreadyExistsError('LocationAlreadyExistsError'),
      new AuditEventAlreadyExistsError('AuditEventAlreadyExistsError')
    ]

    expect(errors.map((error) => error.code)).toEqual([
      'REPOSITORY_VALIDATION_ERROR',
      'REPOSITORY_READ_ERROR',
      'REPOSITORY_WRITE_ERROR',
      'REPOSITORY_DATA_INTEGRITY_ERROR',
      'INSTALLATION_ALREADY_EXISTS',
      'LOCAL_USER_ALREADY_EXISTS',
      'LOCATION_ALREADY_EXISTS',
      'AUDIT_EVENT_ALREADY_EXISTS'
    ])
    expect(errors.map((error) => error.message)).toEqual([
      'Repository input or row value failed validation.',
      'Repository read could not be completed.',
      'Repository write could not be completed.',
      'Repository data does not match the trusted contract.',
      'Installation already exists.',
      'Local user already exists.',
      'Location already exists.',
      'Audit event already exists.'
    ])

    for (const error of errors) {
      expect(isRepositoryError(error)).toBe(true)
      expect(error).not.toHaveProperty('cause')
      expect(error.stack).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain('stack')
      expect(JSON.stringify(error)).not.toContain('secret')
      expect(JSON.stringify(error)).not.toContain('SELECT')
      expect(JSON.stringify(error)).not.toContain('Africa/Douala')
    }
  })

  it('sanitizes arbitrary error types and rebuilds clean instances', () => {
    const incoming = new RepositoryWriteError('passwordHash') as RepositoryWriteError & {
      cause: Error
      deploymentName: string
      stack: string
    }
    incoming.cause = new Error('C:\\secret\\health-screening.sqlite3')
    incoming.deploymentName = 'Secret Deployment'
    incoming.stack = 'SELECT * FROM installation'

    const rebuilt = rebuildRepositoryError(incoming)

    expect(rebuilt).toBeInstanceOf(RepositoryWriteError)
    expect(rebuilt).not.toBe(incoming)
    expect(rebuilt.errorType).toBe('UnknownError')
    expect(rebuilt).not.toHaveProperty('cause')
    expect(rebuilt.stack).toBeUndefined()
    expect(JSON.stringify(rebuilt)).not.toContain('Secret Deployment')
    expect(JSON.stringify(rebuilt)).not.toContain('SELECT')
  })

  it('does not trust raw errors renamed as repository errors', () => {
    const rawError = new Error('C:\\secret\\health-screening.sqlite3')
    rawError.name = 'RepositoryReadError'

    expect(isRepositoryError(rawError)).toBe(false)
  })
})
