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

export class MigrationManifestError extends Error {
  constructor(message = 'Invalid database migration manifest.') {
    super(message)
    this.name = 'MigrationManifestError'
  }
}

export class MigrationCompatibilityError extends Error {
  constructor(message = 'Database migration history is incompatible.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'MigrationCompatibilityError'
  }
}

export class MigrationExecutionError extends Error {
  constructor(message = 'Database migration execution failed.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'MigrationExecutionError'
  }
}
