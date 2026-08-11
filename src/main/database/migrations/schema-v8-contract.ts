import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import type {
  SchemaVersion1ColumnContract,
  SchemaVersion1TableContract
} from './schema-v1-contract'
import {
  schemaVersion7NamedIndexes,
  schemaVersion7TableContracts,
  schemaVersion7TableNames,
  schemaVersion7TriggerNames
} from './schema-v7-contract'
import { hasRequiredSchemaVersion6Invariants } from './schema-v6-contract'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

interface SqliteColumnInfoRow {
  name: unknown
  type: unknown
  notnull: unknown
  dflt_value: unknown
  pk: unknown
  hidden: unknown
}

interface SqliteForeignKeyRow {
  table: unknown
  from: unknown
  to: unknown
  on_update: unknown
  on_delete: unknown
}

interface SqliteNameRow {
  name: unknown
}

interface ForeignKeyContract {
  readonly tableName: string
  readonly from: string
  readonly toTable: string
  readonly to: string
  readonly onUpdate: string
  readonly onDelete: string
}

const screeningVitalsDraftsTable = table('screening_vitals_drafts', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('status'),
  realOptional('weight_kg'),
  realOptional('waist_cm'),
  textOptional('notes'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at'),
  integerRequired('row_version')
])

const screeningVitalsDraftReadingsTable = table('screening_vitals_draft_readings', [
  textPk('id'),
  textRequired('vitals_draft_id'),
  integerRequired('sequence_number'),
  integerOptional('systolic'),
  integerOptional('diastolic'),
  integerOptional('pulse'),
  textOptional('measurement_site'),
  textOptional('patient_position'),
  textOptional('measurement_time'),
  textRequired('created_at'),
  textRequired('updated_at')
])

const requiredForeignKeys = Object.freeze([
  foreignKey('screening_vitals_drafts', 'encounter_id', 'screening_encounters', 'id'),
  foreignKey('screening_vitals_drafts', 'created_by', 'users', 'id'),
  foreignKey('screening_vitals_drafts', 'updated_by', 'users', 'id'),
  foreignKey('screening_vitals_draft_readings', 'vitals_draft_id', 'screening_vitals_drafts', 'id')
])

const requiredTableSqlSnippets = Object.freeze([
  "status TEXT NOT NULL CHECK (status IN ('DRAFT', 'VITALS_COMPLETE'))",
  'weight_kg REAL NULL CHECK (weight_kg IS NULL OR weight_kg > 0)',
  'waist_cm REAL NULL CHECK (waist_cm IS NULL OR waist_cm > 0)',
  'row_version INTEGER NOT NULL CHECK (row_version >= 1)',
  'CONSTRAINT ck_screening_vitals_drafts_updated_at CHECK (updated_at >= created_at)',
  'measurement_site TEXT NULL CHECK',
  "measurement_site IN ('RIGHT_ARM', 'LEFT_ARM', 'LEFT_LEG', 'RIGHT_LEG')",
  'patient_position TEXT NULL CHECK',
  "patient_position IN ('LYING', 'STANDING', 'SITTING')",
  'measurement_time TEXT NULL CHECK',
  "measurement_time GLOB '[0-2][0-9]:[0-5][0-9]'",
  'CONSTRAINT ck_screening_vitals_draft_readings_time_hour CHECK',
  'CAST(substr(measurement_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23'
])

export const schemaVersion8TableContracts = Object.freeze(
  [
    ...schemaVersion7TableContracts,
    screeningVitalsDraftReadingsTable,
    screeningVitalsDraftsTable
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion8TableNames = Object.freeze(
  [...schemaVersion7TableNames, 'screening_vitals_draft_readings', 'screening_vitals_drafts'].sort()
)

export const schemaVersion8TriggerNames = schemaVersion7TriggerNames

export const schemaVersion8NamedIndexes = Object.freeze(
  [
    ...schemaVersion7NamedIndexes,
    'ix_screening_vitals_draft_readings_draft',
    'ix_screening_vitals_drafts_encounter',
    'ux_screening_vitals_draft_readings_sequence'
  ].sort()
)

export function validateSchemaVersion8(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (
    !isSchemaVersion8Valid(connection, { requireForeignKeyEnforcement: mode === 'compatibility' })
  ) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion8Valid(
  connection: MigrationConnection,
  options: { readonly requireForeignKeyEnforcement: boolean }
): boolean {
  try {
    return (
      hasRequiredSchemaVersion6Invariants(connection, {
        requireForeignKeyEnforcement: options.requireForeignKeyEnforcement,
        namedIndexes: schemaVersion8NamedIndexes,
        tableNames: schemaVersion8TableNames
      }) &&
      hasExactTableNames(connection) &&
      hasExactStrictTables(connection) &&
      hasExactNamedIndexes(connection) &&
      hasExactTriggerNames(connection) &&
      hasExactColumns(connection) &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredTableSql(connection)
    )
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion8TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    (
      connection.prepare('PRAGMA table_list').all() as ReadonlyArray<{
        schema: unknown
        name: unknown
        type: unknown
        strict: unknown
      }>
    )
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [String(row.name), Number(row.strict)])
  )

  return schemaVersion8TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion8NamedIndexes)
}

function hasExactTriggerNames(connection: MigrationConnection): boolean {
  return arraysEqual(readTriggerNames(connection), schemaVersion8TriggerNames)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion8TableContracts.every((tableContract) =>
    columnsMatch(readTableColumns(connection, tableContract.name), tableContract.columns)
  )
}

function hasRequiredForeignKeys(connection: MigrationConnection): boolean {
  return requiredForeignKeys.every((expected) =>
    readForeignKeys(connection, expected.tableName).some(
      (actual) =>
        actual.from === expected.from &&
        actual.toTable === expected.toTable &&
        actual.to === expected.to &&
        actual.onUpdate === expected.onUpdate &&
        actual.onDelete === expected.onDelete
    )
  )
}

function hasRequiredTableSql(connection: MigrationConnection): boolean {
  const sql = [
    readCreateTableSql(connection, 'screening_vitals_drafts'),
    readCreateTableSql(connection, 'screening_vitals_draft_readings')
  ]
    .map(normalizeSchemaSql)
    .join(' ')

  return requiredTableSqlSnippets.every((snippet) => sql.includes(normalizeSchemaSql(snippet)))
}

function readNonInternalTableNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readNamedIndexNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readTriggerNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'trigger'
         ORDER BY name`
      )
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readTableColumns(
  connection: MigrationConnection,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
  return (
    connection
      .prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`)
      .all() as SqliteColumnInfoRow[]
  ).map((row) => ({
    name: String(row.name),
    type: String(row.type) as SqliteStorageType,
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function readForeignKeys(
  connection: MigrationConnection,
  tableName: string
): readonly ForeignKeyContract[] {
  return (
    connection
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)
      .all() as SqliteForeignKeyRow[]
  ).map((row) => ({
    tableName,
    from: String(row.from),
    toTable: String(row.table),
    to: String(row.to),
    onUpdate: String(row.on_update),
    onDelete: String(row.on_delete)
  }))
}

function readCreateTableSql(connection: MigrationConnection, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined

  return typeof row?.sql === 'string' ? row.sql : ''
}

function columnsMatch(
  actualColumns: readonly SchemaVersion1ColumnContract[],
  expectedColumns: readonly SchemaVersion1ColumnContract[]
): boolean {
  if (actualColumns.length !== expectedColumns.length) {
    return false
  }

  return actualColumns.every((actualColumn, index) => {
    const expectedColumn = expectedColumns[index]

    return (
      expectedColumn !== undefined &&
      actualColumn.name === expectedColumn.name &&
      actualColumn.type === expectedColumn.type &&
      actualColumn.notNull === expectedColumn.notNull &&
      actualColumn.primaryKey === expectedColumn.primaryKey &&
      actualColumn.defaultValue === expectedColumn.defaultValue &&
      actualColumn.hidden === expectedColumn.hidden
    )
  })
}

function foreignKey(
  tableName: string,
  from: string,
  toTable: string,
  to: string
): ForeignKeyContract {
  return Object.freeze({
    tableName,
    from,
    toTable,
    to,
    onUpdate: 'RESTRICT',
    onDelete: 'RESTRICT'
  })
}

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({
    name,
    columns: Object.freeze([...columns])
  })
}

function textPk(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 1, 1)
}

function textRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 1, 0)
}

function textOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 0, 0)
}

function integerRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 1, 0)
}

function integerOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 0, 0)
}

function realOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'REAL', 0, 0)
}

function column(
  name: string,
  type: SqliteStorageType,
  notNull: 0 | 1,
  primaryKey: number
): SchemaVersion1ColumnContract {
  return Object.freeze({
    name,
    type,
    notNull,
    primaryKey,
    defaultValue: null,
    hidden: 0
  })
}

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  )
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}
