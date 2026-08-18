import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'

import { databaseMigrations, resolveDatabaseMigrations } from './migration-manifest'
import { createProductionDatabaseMigrationRunner } from './index'
import {
  schemaVersion12NamedIndexes,
  schemaVersion12TriggerNames,
  validateSchemaVersion12
} from './schema-v12-contract'

export const hsd046KnownDraftVersion12Checksum =
  '7a4815b374ce73e7752871461c00d21b9ad870567063f17e77bcc6aeb61dd39a'

export interface Hsd046DraftV12RecoveryOptions {
  databasePath: string
  backupDirectory: string
  applicationVersion: string
  confirmApplicationStopped: true
  repositoryRoot?: string
  now?: () => string
  logger?: {
    info(message: string): void
    error(message: string): void
  }
}

export interface Hsd046DraftV12RecoveryResult {
  recovered: true
  databasePath: string
  backupPath: string
  backupSizeBytes: number
  backupSha256: string
  beforeUserVersion: 12
  afterUserVersion: 12
  draftChecksum: string
  finalChecksum: string
}

interface LedgerRow {
  version: number
  name: string
  checksum: string
  applied_at: string
  application_version: string
}

interface TableCountRow {
  name: string
  count: number
}

const defaultLogger = {
  info: (): void => undefined,
  error: (): void => undefined
}

const otherActivityTableName = 'lifestyle_other_activity_rows'

const knownDraftOtherActivityRowsSql = normalizeSchemaSql(`
CREATE TABLE lifestyle_other_activity_rows (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  category TEXT NOT NULL CHECK (
    category IN ('FARMING_GARDENING', 'HOUSEHOLD', 'CAREGIVING', 'COMMUNITY', 'COMMUTE', 'SPORT', 'OTHER')
  ),
  description TEXT NULL,
  days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7),
  average_minutes_per_day INTEGER NOT NULL CHECK (average_minutes_per_day > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_other_activity_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT fk_lifestyle_other_activity_rows_parent FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_other_activity_rows_sequence UNIQUE (lifestyle_draft_id, sequence_number)
) STRICT
`)

const finalOtherActivityRowsCreateSql = `
CREATE TABLE lifestyle_other_activity_rows (
  id TEXT PRIMARY KEY,
  lifestyle_draft_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  category TEXT NOT NULL CHECK (
    category IN ('FARMING_GARDENING', 'HOUSEHOLD', 'CAREGIVING', 'COMMUNITY', 'COMMUTE', 'SPORT', 'OTHER')
  ),
  description TEXT NULL,
  days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7),
  average_minutes_per_day INTEGER NOT NULL CHECK (average_minutes_per_day > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT ck_lifestyle_other_activity_rows_updated_at CHECK (updated_at >= created_at),
  CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank
    CHECK (description IS NULL OR TRIM(description) != ''),
  CONSTRAINT fk_lifestyle_other_activity_rows_parent FOREIGN KEY (lifestyle_draft_id)
    REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY (updated_by)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ux_lifestyle_other_activity_rows_sequence UNIQUE (lifestyle_draft_id, sequence_number)
) STRICT;
`

const copyOtherActivityRowsSql = `
INSERT INTO lifestyle_other_activity_rows (
  id,
  lifestyle_draft_id,
  sequence_number,
  category,
  description,
  days_in_past_seven_days,
  average_minutes_per_day,
  intensity,
  created_by,
  created_at,
  updated_by,
  updated_at
)
SELECT
  id,
  lifestyle_draft_id,
  sequence_number,
  category,
  description,
  days_in_past_seven_days,
  average_minutes_per_day,
  intensity,
  created_by,
  created_at,
  updated_by,
  updated_at
FROM lifestyle_other_activity_rows_legacy;
`

const finalOtherActivityRowsIndexSql = `
CREATE INDEX ix_lifestyle_other_activity_rows_draft
  ON lifestyle_other_activity_rows (lifestyle_draft_id);
`

const finalVersion12Migration = getRequiredMigration(12)
const finalVersion12Checksum = finalVersion12Migration.checksum

export async function recoverHsd046DraftV12Database({
  databasePath,
  backupDirectory,
  applicationVersion,
  confirmApplicationStopped,
  repositoryRoot,
  now = () => new Date().toISOString(),
  logger = defaultLogger
}: Hsd046DraftV12RecoveryOptions): Promise<Hsd046DraftV12RecoveryResult> {
  if (confirmApplicationStopped !== true) {
    throw new Hsd046DraftV12RecoveryError('ApplicationStoppedConfirmationRequired')
  }

  const resolvedDatabasePath = resolveDatabasePath(databasePath)
  const resolvedBackupDirectory = resolveBackupDirectory(backupDirectory, repositoryRoot)
  const backup = await createVerifiedBackup(resolvedDatabasePath, resolvedBackupDirectory, now)

  const connection = new Database(resolvedDatabasePath, { fileMustExist: true })

  try {
    configureConnection(connection)
    assertKnownDraftV12State(connection)

    const beforeCounts = readTableCounts(connection)
    const beforeUserVersion = readUserVersion(connection)

    setForeignKeyEnforcement(connection, false)

    let transactionStarted = false
    try {
      connection.exec('BEGIN IMMEDIATE')
      transactionStarted = true

      connection.exec(
        'ALTER TABLE lifestyle_other_activity_rows RENAME TO lifestyle_other_activity_rows_legacy'
      )
      connection.exec(finalOtherActivityRowsCreateSql)
      connection.exec(copyOtherActivityRowsSql)
      assertOtherActivityRowsPreserved(connection)
      connection.exec('DROP TABLE lifestyle_other_activity_rows_legacy')
      connection.exec(finalOtherActivityRowsIndexSql)
      assertTableCountsMatch(beforeCounts, readTableCounts(connection))
      assertForeignKeyIntegrity(connection)
      assertIntegrity(connection)
      validateSchemaVersion12(connection, 'compatibility')

      const updated = connection
        .prepare(
          `UPDATE schema_migrations
           SET checksum = ?
           WHERE version = 12
             AND name = 'optional-other-activity-description'
             AND checksum = ?`
        )
        .run(finalVersion12Checksum, hsd046KnownDraftVersion12Checksum)

      if (updated.changes !== 1) {
        throw new Hsd046DraftV12RecoveryError('MigrationLedgerUpdateFailed')
      }

      const ledgerRow = readLedgerRow(connection, 12)
      if (ledgerRow.checksum !== finalVersion12Checksum) {
        throw new Hsd046DraftV12RecoveryError('MigrationLedgerVerificationFailed')
      }

      if (readUserVersion(connection) !== 12) {
        throw new Hsd046DraftV12RecoveryError('UnexpectedUserVersionAfterRecovery')
      }

      connection.exec('COMMIT')
      transactionStarted = false
    } catch (error) {
      if (transactionStarted) {
        connection.exec('ROLLBACK')
      }
      throw error
    } finally {
      setForeignKeyEnforcement(connection, true)
    }

    assertForeignKeyIntegrity(connection)
    assertIntegrity(connection)
    validateSchemaVersion12(connection, 'compatibility')
    createProductionDatabaseMigrationRunner({
      applicationVersion,
      logger
    })(connection)

    logger.info('HSD-046 draft-v12 recovery completed.')

    return {
      recovered: true,
      databasePath: resolvedDatabasePath,
      backupPath: backup.path,
      backupSizeBytes: backup.sizeBytes,
      backupSha256: backup.sha256,
      beforeUserVersion,
      afterUserVersion: 12,
      draftChecksum: hsd046KnownDraftVersion12Checksum,
      finalChecksum: finalVersion12Checksum
    }
  } catch (error) {
    logger.error(`HSD-046 draft-v12 recovery failed; errorType=${getErrorType(error)}`)
    throw error
  } finally {
    connection.close()
  }
}

function getRequiredMigration(version: number): { sql: string; checksum: string } {
  const migration = resolveDatabaseMigrations(databaseMigrations).find(
    (candidate) => candidate.version === version
  )

  if (!migration) {
    throw new Hsd046DraftV12RecoveryError('MigrationNotFound')
  }

  return {
    sql: migration.sql,
    checksum: migration.checksum
  }
}

function resolveDatabasePath(databasePath: string): string {
  if (databasePath.trim().length === 0) {
    throw new Hsd046DraftV12RecoveryError('ExplicitDatabasePathRequired')
  }

  const resolved = resolve(databasePath)
  const parsed = parse(resolved)

  if (!isAbsolute(resolved) || resolved === parsed.root || dirname(resolved) === resolved) {
    throw new Hsd046DraftV12RecoveryError('UnsafeDatabasePath')
  }

  const stat = statSync(resolved)
  if (!stat.isFile()) {
    throw new Hsd046DraftV12RecoveryError('DatabasePathMustBeFile')
  }

  const header = readFileSync(resolved, { encoding: null }).subarray(0, 16).toString('binary')
  if (header !== 'SQLite format 3\u0000') {
    throw new Hsd046DraftV12RecoveryError('DatabasePathMustBeSqlite')
  }

  return resolved
}

function resolveBackupDirectory(backupDirectory: string, repositoryRoot?: string): string {
  if (backupDirectory.trim().length === 0) {
    throw new Hsd046DraftV12RecoveryError('ExplicitBackupDirectoryRequired')
  }

  const resolved = resolve(backupDirectory)
  const parsed = parse(resolved)

  if (!isAbsolute(resolved) || resolved === parsed.root || basename(resolved).trim().length === 0) {
    throw new Hsd046DraftV12RecoveryError('UnsafeBackupDirectory')
  }

  if (repositoryRoot && isPathInside(resolve(repositoryRoot), resolved)) {
    throw new Hsd046DraftV12RecoveryError('BackupDirectoryInsideRepository')
  }

  mkdirSync(resolved, { recursive: true })

  const stat = statSync(resolved)
  if (!stat.isDirectory()) {
    throw new Hsd046DraftV12RecoveryError('BackupDirectoryMustBeDirectory')
  }

  return resolved
}

async function createVerifiedBackup(
  databasePath: string,
  backupDirectory: string,
  now: () => string
): Promise<{ path: string; sizeBytes: number; sha256: string }> {
  const backupPath = join(
    backupDirectory,
    `health-screening.${now().replace(/[:.]/g, '-')}.sqlite3.backup`
  )
  const source = new Database(databasePath, { readonly: true, fileMustExist: true })

  try {
    await source.backup(backupPath)
  } finally {
    source.close()
  }

  const backup = new Database(backupPath, { readonly: true, fileMustExist: true })
  try {
    assertIntegrity(backup)
  } finally {
    backup.close()
  }

  const bytes = readFileSync(backupPath)

  return {
    path: backupPath,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

function configureConnection(connection: Database.Database): void {
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
  setForeignKeyEnforcement(connection, true)
}

function assertKnownDraftV12State(connection: Database.Database): void {
  if (readUserVersion(connection) !== 12) {
    throw new Hsd046DraftV12RecoveryError('ExpectedSchemaVersion12')
  }

  const ledgerRows = readLedgerRows(connection)
  if (ledgerRows.length !== 12) {
    throw new Hsd046DraftV12RecoveryError('UnexpectedMigrationLedgerLength')
  }

  const resolvedMigrations = resolveDatabaseMigrations(databaseMigrations)
  for (const row of ledgerRows) {
    const migration = resolvedMigrations.find((candidate) => candidate.version === row.version)
    if (!migration || row.name !== migration.name) {
      throw new Hsd046DraftV12RecoveryError('UnexpectedMigrationLedgerIdentity')
    }

    if (row.version < 12 && row.checksum !== migration.checksum) {
      throw new Hsd046DraftV12RecoveryError('UnexpectedMigrationLedgerChecksum')
    }

    if (
      row.version === 12 &&
      (row.name !== 'optional-other-activity-description' ||
        row.checksum !== hsd046KnownDraftVersion12Checksum)
    ) {
      throw new Hsd046DraftV12RecoveryError('UnexpectedDraftVersion12Checksum')
    }
  }

  if (readCreateTableSql(connection, otherActivityTableName) !== knownDraftOtherActivityRowsSql) {
    throw new Hsd046DraftV12RecoveryError('UnexpectedDraftOtherActivitySchema')
  }

  if (!arraysEqual(readIndexNames(connection), schemaVersion12NamedIndexes)) {
    throw new Hsd046DraftV12RecoveryError('UnexpectedDraftIndexSet')
  }

  if (!arraysEqual(readTriggerNames(connection), schemaVersion12TriggerNames)) {
    throw new Hsd046DraftV12RecoveryError('UnexpectedDraftTriggerSet')
  }

  const invalidDescriptionCount = (
    connection
      .prepare(
        `SELECT COUNT(*) AS count
         FROM lifestyle_other_activity_rows
         WHERE description IS NOT NULL
           AND TRIM(description) = ''`
      )
      .get() as { count: number }
  ).count

  if (invalidDescriptionCount !== 0) {
    throw new Hsd046DraftV12RecoveryError('DraftContainsInvalidDescriptions')
  }

  assertForeignKeyIntegrity(connection)
  assertIntegrity(connection)
}

function assertOtherActivityRowsPreserved(connection: Database.Database): void {
  const differenceCount = (
    connection
      .prepare(
        `SELECT COUNT(*) AS count
         FROM (
           SELECT
             id,
             lifestyle_draft_id,
             sequence_number,
             category,
             description,
             days_in_past_seven_days,
             average_minutes_per_day,
             intensity,
             created_by,
             created_at,
             updated_by,
             updated_at
           FROM lifestyle_other_activity_rows_legacy
           EXCEPT
           SELECT
             id,
             lifestyle_draft_id,
             sequence_number,
             category,
             description,
             days_in_past_seven_days,
             average_minutes_per_day,
             intensity,
             created_by,
             created_at,
             updated_by,
             updated_at
           FROM lifestyle_other_activity_rows
           UNION ALL
           SELECT
             id,
             lifestyle_draft_id,
             sequence_number,
             category,
             description,
             days_in_past_seven_days,
             average_minutes_per_day,
             intensity,
             created_by,
             created_at,
             updated_by,
             updated_at
           FROM lifestyle_other_activity_rows
           EXCEPT
           SELECT
             id,
             lifestyle_draft_id,
             sequence_number,
             category,
             description,
             days_in_past_seven_days,
             average_minutes_per_day,
             intensity,
             created_by,
             created_at,
             updated_by,
             updated_at
           FROM lifestyle_other_activity_rows_legacy
         )`
      )
      .get() as { count: number }
  ).count

  if (differenceCount !== 0) {
    throw new Hsd046DraftV12RecoveryError('OtherActivityRowsNotPreserved')
  }
}

function readTableCounts(connection: Database.Database): readonly TableCountRow[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as readonly { name: string }[]
  ).map((row) => ({
    name: row.name,
    count: (
      connection
        .prepare(`SELECT COUNT(*) AS count FROM "${row.name.replaceAll('"', '""')}"`)
        .get() as {
        count: number
      }
    ).count
  }))
}

function assertTableCountsMatch(
  beforeCounts: readonly TableCountRow[],
  afterCounts: readonly TableCountRow[]
): void {
  if (JSON.stringify(beforeCounts) !== JSON.stringify(afterCounts)) {
    throw new Hsd046DraftV12RecoveryError('TableCountsChanged')
  }
}

function readUserVersion(connection: Database.Database): 12 {
  const userVersion = connection.pragma('user_version', { simple: true })
  if (userVersion !== 12) {
    throw new Hsd046DraftV12RecoveryError('UnexpectedUserVersion')
  }
  return 12
}

function readLedgerRows(connection: Database.Database): LedgerRow[] {
  return connection
    .prepare(
      `SELECT version, name, checksum, applied_at, application_version
       FROM schema_migrations
       ORDER BY version`
    )
    .all() as LedgerRow[]
}

function readLedgerRow(connection: Database.Database, version: number): LedgerRow {
  const row = connection
    .prepare(
      `SELECT version, name, checksum, applied_at, application_version
       FROM schema_migrations
       WHERE version = ?`
    )
    .get(version) as LedgerRow | undefined

  if (!row) {
    throw new Hsd046DraftV12RecoveryError('MissingMigrationLedgerRow')
  }

  return row
}

function readCreateTableSql(connection: Database.Database, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined

  return normalizeSchemaSql(typeof row?.sql === 'string' ? row.sql : '')
}

function readIndexNames(connection: Database.Database): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all() as readonly { name: string }[]
  ).map((row) => row.name)
}

function readTriggerNames(connection: Database.Database): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
         ORDER BY name`
      )
      .all() as readonly { name: string }[]
  ).map((row) => row.name)
}

function setForeignKeyEnforcement(connection: Database.Database, enabled: boolean): void {
  connection.pragma(`foreign_keys = ${enabled ? 'ON' : 'OFF'}`)

  const actual = connection.pragma('foreign_keys', { simple: true })
  if (actual !== (enabled ? 1 : 0)) {
    throw new Hsd046DraftV12RecoveryError('ForeignKeyModeChangeFailed')
  }
}

function assertForeignKeyIntegrity(connection: Database.Database): void {
  const violations = connection.pragma('foreign_key_check') as unknown[]

  if (violations.length > 0) {
    throw new Hsd046DraftV12RecoveryError('ForeignKeyCheckFailed')
  }
}

function assertIntegrity(connection: Database.Database): void {
  if (connection.pragma('integrity_check', { simple: true }) !== 'ok') {
    throw new Hsd046DraftV12RecoveryError('IntegrityCheckFailed')
  }
}

function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*$/, '')
    .trim()
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isPathInside(parent: string, child: string): boolean {
  const childRelativeToParent = relative(parent, child)
  return (
    childRelativeToParent.length === 0 ||
    (!childRelativeToParent.startsWith('..') && !isAbsolute(childRelativeToParent))
  )
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

export class Hsd046DraftV12RecoveryError extends Error {
  constructor(reason: string) {
    super(`HSD-046 draft-v12 recovery refused: ${reason}.`)
    this.name = 'Hsd046DraftV12RecoveryError'
  }
}
