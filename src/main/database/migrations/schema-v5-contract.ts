import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  hasRequiredSchemaVersion4Invariants,
  schemaVersion4NamedIndexes,
  schemaVersion4TableContracts,
  schemaVersion4TableNames,
  schemaVersion4TriggerNames
} from './schema-v4-contract'

interface SqliteIndexListRow {
  name: unknown
  unique: unknown
  partial: unknown
}

interface SqliteIndexXInfoRow {
  seqno: unknown
  name: unknown
  desc: unknown
  key: unknown
}

interface SqliteSqlRow {
  sql: unknown
}

interface IndexColumnContract {
  readonly name: string
  readonly descending: boolean
}

const rootEncounterIdentityIndexName = 'ux_screening_encounters_root_session_patient'

export const schemaVersion5TableContracts = schemaVersion4TableContracts
export const schemaVersion5TableNames = schemaVersion4TableNames
export const schemaVersion5TriggerNames = schemaVersion4TriggerNames
export const schemaVersion5NamedIndexes = Object.freeze(
  [...schemaVersion4NamedIndexes, rootEncounterIdentityIndexName].sort()
)

export function validateSchemaVersion5(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (
    !isSchemaVersion5Valid(connection, { requireForeignKeyEnforcement: mode === 'compatibility' })
  ) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion5Valid(
  connection: MigrationConnection,
  options: { readonly requireForeignKeyEnforcement: boolean }
): boolean {
  try {
    return (
      hasRequiredSchemaVersion4Invariants(connection, {
        requireForeignKeyEnforcement: options.requireForeignKeyEnforcement,
        namedIndexes: schemaVersion5NamedIndexes
      }) && hasRequiredRootEncounterIdentityIndex(connection)
    )
  } catch {
    return false
  }
}

function hasRequiredRootEncounterIdentityIndex(connection: MigrationConnection): boolean {
  const indexes = readTableIndexes(connection, 'screening_encounters')
  const index = indexes.find((candidate) => candidate.name === rootEncounterIdentityIndexName)

  return (
    index !== undefined &&
    index.unique &&
    index.partial &&
    indexColumnsEqual(readIndexKeyColumns(connection, rootEncounterIdentityIndexName), [
      { name: 'screening_session_id', descending: false },
      { name: 'patient_id', descending: false }
    ]) &&
    normalizeSchemaSql(readCreateSql(connection, 'index', rootEncounterIdentityIndexName)) ===
      normalizeSchemaSql(
        `CREATE UNIQUE INDEX ${rootEncounterIdentityIndexName}
          ON screening_encounters (screening_session_id, patient_id)
          WHERE amendment_of_encounter_id IS NULL`
      )
  )
}

function readTableIndexes(
  connection: MigrationConnection,
  tableName: string
): ReadonlyArray<{ name: string; unique: boolean; partial: boolean }> {
  return (
    connection
      .prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
      .all() as SqliteIndexListRow[]
  ).map((row) => ({
    name: String(row.name),
    unique: Number(row.unique) === 1,
    partial: Number(row.partial) === 1
  }))
}

function readIndexKeyColumns(
  connection: MigrationConnection,
  indexName: string
): readonly IndexColumnContract[] {
  return (
    connection
      .prepare(`PRAGMA index_xinfo(${quoteIdentifier(indexName)})`)
      .all() as SqliteIndexXInfoRow[]
  )
    .filter((row) => Number(row.key) === 1)
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((row) => ({
      name: String(row.name),
      descending: Number(row.desc) === 1
    }))
}

function readCreateSql(connection: MigrationConnection, objectType: 'index', name: string): string {
  const row = connection
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(objectType, name) as SqliteSqlRow | undefined

  return typeof row?.sql === 'string' ? row.sql : ''
}

function indexColumnsEqual(
  actual: readonly IndexColumnContract[],
  expected: readonly IndexColumnContract[]
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((actualColumn, index) => {
      const expectedColumn = expected[index]

      return (
        expectedColumn !== undefined &&
        actualColumn.name === expectedColumn.name &&
        actualColumn.descending === expectedColumn.descending
      )
    })
  )
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}
