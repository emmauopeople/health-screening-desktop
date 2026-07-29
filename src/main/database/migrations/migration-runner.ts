import {
  canonicalizeMigrationSql,
  computeMigrationChecksum,
  isSha256Checksum
} from './migration-checksum'
import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  MigrationManifestError,
  type DatabaseMigration,
  type DatabaseMigrationClock,
  type DatabaseMigrationContext,
  type DatabaseMigrationLogger,
  type DatabaseMigrationSummary,
  type MigrationConnection,
  type ResolvedDatabaseMigration
} from './migration-types'

const migrationNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const defaultLogger: DatabaseMigrationLogger = console

const defaultClock: DatabaseMigrationClock = {
  now: () => new Date().toISOString()
}

interface RunDatabaseMigrationsOptions extends DatabaseMigrationContext {
  migrations: readonly DatabaseMigration[]
  expectedHighestVersion?: number
}

interface LedgerRow {
  version: number
  name: string
  checksum: string
  applied_at: string
  application_version: string
}

interface DatabaseMigrationState {
  userVersion: number
  ledgerExists: boolean
  appliedRows: readonly LedgerRow[]
}

interface MigrationFailureContext {
  version: number
  name: string
  phase: string
}

export function validateMigrationManifest(
  migrations: readonly DatabaseMigration[],
  options: { expectedHighestVersion?: number } = {}
): readonly ResolvedDatabaseMigration[] {
  if (migrations.length === 0) {
    throw new MigrationManifestError()
  }

  const seenVersions = new Set<number>()
  const seenNames = new Set<string>()

  return migrations.map((migration, index) => {
    const expectedVersion = index + 1

    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new MigrationManifestError()
    }

    if (migration.version !== expectedVersion) {
      throw new MigrationManifestError()
    }

    if (seenVersions.has(migration.version)) {
      throw new MigrationManifestError()
    }
    seenVersions.add(migration.version)

    if (!migrationNamePattern.test(migration.name) || seenNames.has(migration.name)) {
      throw new MigrationManifestError()
    }
    seenNames.add(migration.name)

    const canonicalSql = canonicalizeMigrationSql(migration.sql)

    if (canonicalSql.trim().length === 0) {
      throw new MigrationManifestError()
    }

    if (
      options.expectedHighestVersion !== undefined &&
      index === migrations.length - 1 &&
      migration.version !== options.expectedHighestVersion
    ) {
      throw new MigrationManifestError()
    }

    return {
      ...migration,
      sql: canonicalSql,
      checksum: computeMigrationChecksum(migration.sql)
    }
  })
}

export function runDatabaseMigrations({
  connection,
  migrations,
  applicationVersion,
  logger = defaultLogger,
  clock = defaultClock,
  expectedHighestVersion
}: RunDatabaseMigrationsOptions): DatabaseMigrationSummary {
  const resolvedMigrations = validateMigrationManifest(migrations, { expectedHighestVersion })
  const highestVersion = resolvedMigrations[resolvedMigrations.length - 1]?.version

  if (highestVersion === undefined) {
    throw new MigrationManifestError()
  }

  if (connection.inTransaction) {
    throw new MigrationExecutionError()
  }

  const startingState = readAndValidateDatabaseState(connection, resolvedMigrations)

  if (startingState.userVersion > highestVersion) {
    throw new MigrationCompatibilityError('Database schema is newer than this application.')
  }

  const appliedVersions: number[] = []

  for (const migration of resolvedMigrations) {
    if (migration.version <= startingState.userVersion) {
      continue
    }

    applyMigration(connection, migration, {
      applicationVersion,
      logger,
      clock,
      createLedger: migration.version === 1 && startingState.userVersion === 0
    })
    appliedVersions.push(migration.version)
  }

  const finalState = readAndValidateDatabaseState(connection, resolvedMigrations)

  if (finalState.userVersion !== highestVersion) {
    throw new MigrationCompatibilityError()
  }

  logger.info(`Database migrations current; schemaVersion=${highestVersion}`)

  return {
    previousVersion: startingState.userVersion,
    currentVersion: finalState.userVersion,
    appliedVersions
  }
}

function readAndValidateDatabaseState(
  connection: MigrationConnection,
  migrations: readonly ResolvedDatabaseMigration[]
): DatabaseMigrationState {
  const userVersion = readUserVersion(connection)
  const ledgerExists = hasTable(connection, 'schema_migrations')
  const highestVersion = migrations[migrations.length - 1]?.version ?? 0

  if (userVersion > highestVersion) {
    throw new MigrationCompatibilityError('Database schema is newer than this application.')
  }

  if (userVersion === 0) {
    if (ledgerExists) {
      throw new MigrationCompatibilityError()
    }

    return {
      userVersion,
      ledgerExists,
      appliedRows: []
    }
  }

  if (!ledgerExists) {
    throw new MigrationCompatibilityError()
  }

  if (!isStrictTable(connection, 'schema_migrations')) {
    throw new MigrationCompatibilityError()
  }

  const appliedRows = readLedgerRows(connection)
  validateAppliedRows(appliedRows, migrations, userVersion)

  return {
    userVersion,
    ledgerExists,
    appliedRows
  }
}

function validateAppliedRows(
  rows: readonly LedgerRow[],
  migrations: readonly ResolvedDatabaseMigration[],
  userVersion: number
): void {
  if (rows.length !== userVersion) {
    throw new MigrationCompatibilityError()
  }

  const versions = new Set<number>()
  const names = new Set<string>()
  const migrationsByVersion = new Map(migrations.map((migration) => [migration.version, migration]))

  for (const row of rows) {
    if (!Number.isInteger(row.version) || row.version <= 0 || row.version > userVersion) {
      throw new MigrationCompatibilityError()
    }

    if (versions.has(row.version) || names.has(row.name)) {
      throw new MigrationCompatibilityError()
    }
    versions.add(row.version)
    names.add(row.name)

    const migration = migrationsByVersion.get(row.version)

    if (!migration || row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new MigrationCompatibilityError()
    }

    if (!isSha256Checksum(row.checksum)) {
      throw new MigrationCompatibilityError()
    }

    if (row.applied_at.length === 0 || row.application_version.length === 0) {
      throw new MigrationCompatibilityError()
    }
  }

  for (let expectedVersion = 1; expectedVersion <= userVersion; expectedVersion += 1) {
    if (!versions.has(expectedVersion)) {
      throw new MigrationCompatibilityError()
    }
  }
}

function assertLedgerRowMatches(row: LedgerRow, migration: ResolvedDatabaseMigration): void {
  if (
    row.version !== migration.version ||
    row.name !== migration.name ||
    row.checksum !== migration.checksum ||
    row.applied_at.length === 0 ||
    row.application_version.length === 0 ||
    !isSha256Checksum(row.checksum)
  ) {
    throw new MigrationCompatibilityError()
  }
}

function applyMigration(
  connection: MigrationConnection,
  migration: ResolvedDatabaseMigration,
  options: {
    applicationVersion: string
    logger: DatabaseMigrationLogger
    clock: DatabaseMigrationClock
    createLedger: boolean
  }
): void {
  let transactionStarted = false
  let phase = 'begin'
  const failureContext = {
    version: migration.version,
    name: migration.name,
    phase
  }

  options.logger.info(
    `Database migration started; version=${migration.version}; name=${migration.name}`
  )

  try {
    connection.exec('BEGIN IMMEDIATE')
    transactionStarted = true

    phase = 'ledger'
    if (options.createLedger) {
      connection.exec(createLedgerTableSql)
    }

    phase = 'execute'
    connection.exec(migration.sql)

    phase = 'record'
    insertLedgerRow(connection, migration, options.clock.now(), options.applicationVersion)

    phase = 'user_version'
    setUserVersion(connection, migration.version)

    phase = 'verify'
    assertUserVersion(connection, migration.version)
    assertLedgerRowMatches(readLedgerRow(connection, migration.version), migration)

    phase = 'commit'
    connection.exec('COMMIT')
    transactionStarted = false

    options.logger.info(
      `Database migration applied; version=${migration.version}; name=${migration.name}`
    )
  } catch (error) {
    failureContext.phase = phase

    if (transactionStarted) {
      try {
        connection.exec('ROLLBACK')
      } catch (rollbackError) {
        options.logger.error(
          `Database migration rollback failed; version=${migration.version}; name=${migration.name}; phase=rollback; errorType=${getErrorType(rollbackError)}`
        )
      }
    }

    logMigrationFailure(options.logger, failureContext, error)
    throw new MigrationExecutionError('Database migration execution failed.', { cause: error })
  }
}

const createLedgerTableSql = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL,
  application_version TEXT NOT NULL
) STRICT;
`

function readUserVersion(connection: MigrationConnection): number {
  const userVersion = connection.pragma('user_version', { simple: true })

  if (typeof userVersion !== 'number' || !Number.isInteger(userVersion) || userVersion < 0) {
    throw new MigrationCompatibilityError()
  }

  return userVersion
}

function setUserVersion(connection: MigrationConnection, version: number): void {
  if (!Number.isInteger(version) || version <= 0) {
    throw new MigrationExecutionError()
  }

  connection.exec(`PRAGMA user_version = ${version}`)
}

function assertUserVersion(connection: MigrationConnection, expectedVersion: number): void {
  const actualVersion = readUserVersion(connection)

  if (actualVersion !== expectedVersion) {
    throw new MigrationExecutionError()
  }
}

function hasTable(connection: MigrationConnection, tableName: string): boolean {
  const row = connection
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found?: unknown } | undefined

  return row?.found === 1
}

function isStrictTable(connection: MigrationConnection, tableName: string): boolean {
  const rows = connection.prepare('PRAGMA table_list').all() as Array<{
    schema?: unknown
    name?: unknown
    type?: unknown
    strict?: unknown
  }>

  return rows.some(
    (row) =>
      row.schema === 'main' && row.name === tableName && row.type === 'table' && row.strict === 1
  )
}

function readLedgerRows(connection: MigrationConnection): LedgerRow[] {
  try {
    const rows = connection
      .prepare(
        `SELECT version, name, checksum, applied_at, application_version
         FROM schema_migrations
         ORDER BY version`
      )
      .all() as unknown[]

    return rows.map(parseLedgerRow)
  } catch (error) {
    throw new MigrationCompatibilityError('Database migration ledger could not be read.', {
      cause: error
    })
  }
}

function readLedgerRow(connection: MigrationConnection, version: number): LedgerRow {
  const row = connection
    .prepare(
      `SELECT version, name, checksum, applied_at, application_version
       FROM schema_migrations
       WHERE version = ?`
    )
    .get(version) as unknown

  if (!row) {
    throw new MigrationExecutionError()
  }

  return parseLedgerRow(row)
}

function parseLedgerRow(row: unknown): LedgerRow {
  if (typeof row !== 'object' || row === null) {
    throw new MigrationCompatibilityError()
  }

  const candidate = row as Record<string, unknown>

  if (
    typeof candidate.version !== 'number' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.checksum !== 'string' ||
    typeof candidate.applied_at !== 'string' ||
    typeof candidate.application_version !== 'string'
  ) {
    throw new MigrationCompatibilityError()
  }

  return {
    version: candidate.version,
    name: candidate.name,
    checksum: candidate.checksum,
    applied_at: candidate.applied_at,
    application_version: candidate.application_version
  }
}

function insertLedgerRow(
  connection: MigrationConnection,
  migration: ResolvedDatabaseMigration,
  appliedAt: string,
  applicationVersion: string
): void {
  connection
    .prepare(
      `INSERT INTO schema_migrations (
        version,
        name,
        checksum,
        applied_at,
        application_version
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(migration.version, migration.name, migration.checksum, appliedAt, applicationVersion)
}

function logMigrationFailure(
  logger: DatabaseMigrationLogger,
  context: MigrationFailureContext,
  error: unknown
): void {
  logger.error(
    `Database migration failed; version=${context.version}; name=${context.name}; phase=${context.phase}; errorType=${getErrorType(error)}`
  )
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
