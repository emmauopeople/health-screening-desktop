import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  createSchemaMigrationsTableSql,
  schemaVersion1NamedIndexes,
  schemaVersion1TableContracts,
  type SchemaVersion1ColumnContract,
  type SchemaVersion1TableContract
} from './schema-v1-contract'

type SqliteStorageType = 'INTEGER' | 'TEXT'

interface SqliteTableListRow {
  schema: unknown
  name: unknown
  type: unknown
  strict: unknown
}

interface SqliteColumnInfoRow {
  name: unknown
  type: unknown
  notnull: unknown
  dflt_value: unknown
  pk: unknown
  hidden: unknown
}

interface SqliteNameRow {
  name: unknown
}

interface SqliteSqlRow {
  sql: unknown
}

const textPk = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 1)
const textCompositePk = (name: string, primaryKey: number): SchemaVersion1ColumnContract =>
  column(name, 'TEXT', 1, primaryKey)
const integerPk = (name: string): SchemaVersion1ColumnContract => column(name, 'INTEGER', 0, 1)
const textRequired = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 0)
const integerRequired = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 1, 0)
const requiredWithDefault = (
  name: string,
  type: SqliteStorageType,
  defaultValue: string
): SchemaVersion1ColumnContract => Object.freeze({ ...column(name, type, 1, 0), defaultValue })

const patientV2Columns = appendColumns(getVersion1Columns('patients'), [
  requiredWithDefault('row_version', 'INTEGER', '1')
])

const patientIdentifierV2Columns = appendColumns(getVersion1Columns('patient_identifiers'), [
  requiredWithDefault('status', 'TEXT', "'ACTIVE'")
])

const hsd025Tables = Object.freeze([
  table('patient_duplicate_reviews', [
    textPk('id'),
    textRequired('patient_id_a'),
    textRequired('patient_id_b'),
    textRequired('pair_key'),
    integerRequired('patient_a_row_version'),
    integerRequired('patient_b_row_version'),
    textRequired('patient_a_identity_key'),
    textRequired('patient_b_identity_key'),
    textRequired('status'),
    textRequired('reason_codes_json'),
    textRequired('reviewed_by'),
    textRequired('reviewed_at')
  ]),
  table('patient_local_sequence', [
    integerPk('singleton_id'),
    integerRequired('next_value'),
    textRequired('updated_at')
  ]),
  table('patient_recent_access', [
    textCompositePk('user_id', 1),
    textCompositePk('patient_id', 2),
    textRequired('last_viewed_at')
  ])
])

export const schemaVersion2TableContracts = Object.freeze(
  [
    ...schemaVersion1TableContracts.map((contract) => {
      if (contract.name === 'patients') {
        return table('patients', patientV2Columns)
      }

      if (contract.name === 'patient_identifiers') {
        return table('patient_identifiers', patientIdentifierV2Columns)
      }

      return contract
    }),
    ...hsd025Tables
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion2TableNames = Object.freeze(
  schemaVersion2TableContracts.map((contract) => contract.name)
)

export const schemaVersion2NamedIndexes = Object.freeze(
  [
    ...schemaVersion1NamedIndexes,
    'ix_patient_duplicate_reviews_pair_status',
    'ix_patient_duplicate_reviews_patient_a',
    'ix_patient_duplicate_reviews_patient_b',
    'ix_patient_identifiers_status',
    'ix_patient_recent_access_user_time',
    'ix_patients_age_sex_name',
    'ix_patients_birth_sex_name',
    'ix_patients_village_quarter',
    'ux_patient_duplicate_reviews_suppression'
  ].sort()
)

export function validateSchemaVersion2(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion2Valid(connection)) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion2Valid(connection: MigrationConnection): boolean {
  try {
    return (
      isForeignKeyEnforcementEnabled(connection) &&
      hasExactTableNames(connection) &&
      hasExactStrictTables(connection) &&
      hasExactNamedIndexes(connection) &&
      hasExactColumns(connection) &&
      hasExactSchemaMigrationsSql(connection)
    )
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion2TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    readTableList(connection)
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [row.name, row.strict])
  )

  return schemaVersion2TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion2NamedIndexes)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion2TableContracts.every((tableContract) =>
    columnsMatch(readTableColumns(connection, tableContract.name), tableContract.columns)
  )
}

function hasExactSchemaMigrationsSql(connection: MigrationConnection): boolean {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('schema_migrations') as SqliteSqlRow | undefined

  return (
    typeof row?.sql === 'string' &&
    normalizeSchemaSql(row.sql) === normalizeSchemaSql(createSchemaMigrationsTableSql)
  )
}

function isForeignKeyEnforcementEnabled(connection: MigrationConnection): boolean {
  return connection.pragma('foreign_keys', { simple: true }) === 1
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

function readTableList(connection: MigrationConnection): ReadonlyArray<{
  schema: string
  name: string
  type: string
  strict: number
}> {
  return (connection.prepare('PRAGMA table_list').all() as SqliteTableListRow[]).map((row) => ({
    schema: String(row.schema),
    name: String(row.name),
    type: String(row.type),
    strict: Number(row.strict)
  }))
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

function getVersion1Columns(tableName: string): readonly SchemaVersion1ColumnContract[] {
  const contract = schemaVersion1TableContracts.find((candidate) => candidate.name === tableName)

  if (contract === undefined) {
    throw new MigrationExecutionError()
  }

  return contract.columns
}

function appendColumns(
  columns: readonly SchemaVersion1ColumnContract[],
  additions: readonly SchemaVersion1ColumnContract[]
): readonly SchemaVersion1ColumnContract[] {
  return Object.freeze([...columns, ...additions])
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
