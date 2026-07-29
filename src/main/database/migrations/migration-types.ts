import type Database from 'better-sqlite3'

export type MigrationConnection = Database.Database

export interface DatabaseMigration {
  version: number
  name: string
  sql: string
}

export interface ResolvedDatabaseMigration extends DatabaseMigration {
  checksum: string
}

export interface DatabaseMigrationLogger {
  info(message: string): void
  error(message: string): void
}

export interface DatabaseMigrationClock {
  now(): string
}

export interface DatabaseMigrationContext {
  connection: MigrationConnection
  applicationVersion: string
  logger?: DatabaseMigrationLogger
  clock?: DatabaseMigrationClock
}

export interface DatabaseMigrationSummary {
  previousVersion: number
  currentVersion: number
  appliedVersions: readonly number[]
}

export type DatabaseMigrationRunner = (connection: MigrationConnection) => DatabaseMigrationSummary

export type DatabaseSchemaValidationMode = 'execution' | 'compatibility'

export type DatabaseSchemaValidator = (
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
) => void

class ControlledMigrationError extends Error {
  readonly errorType?: string

  constructor(name: string, message: string, errorType?: string) {
    super(message)
    this.name = name
    this.errorType = errorType
    this.stack = undefined
  }
}

export class MigrationManifestError extends ControlledMigrationError {
  constructor(errorType?: string) {
    super('MigrationManifestError', 'Invalid database migration manifest.', errorType)
  }
}

export class MigrationCompatibilityError extends ControlledMigrationError {
  constructor(errorType?: string) {
    super('MigrationCompatibilityError', 'Database migration history is incompatible.', errorType)
  }
}

export class MigrationExecutionError extends ControlledMigrationError {
  constructor(errorType?: string) {
    super('MigrationExecutionError', 'Database migration execution failed.', errorType)
  }
}
