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
  hasRequiredSchemaVersion5Invariants,
  schemaVersion5NamedIndexes,
  schemaVersion5TableContracts,
  schemaVersion5TableNames,
  schemaVersion5TriggerNames
} from './schema-v5-contract'

type SqliteStorageType = 'INTEGER' | 'TEXT'

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

interface SqliteIndexListRow {
  name: unknown
  unique: unknown
}

interface SqliteIndexXInfoRow {
  seqno: unknown
  name: unknown
  desc: unknown
  key: unknown
}

interface SqliteNameRow {
  name: unknown
}

interface SqliteSqlRow {
  sql: unknown
}

interface ForeignKeyContract {
  readonly tableName: string
  readonly from: string
  readonly toTable: string
  readonly to: string
  readonly onUpdate: string
  readonly onDelete: string
}

interface IndexContract {
  readonly name: string
  readonly tableName: string
  readonly unique: boolean
  readonly columns: readonly IndexColumnContract[]
}

interface IndexColumnContract {
  readonly name: string
  readonly descending: boolean
}

const installationLocationConfigurationTable = table('installation_location_configuration', [
  integerPk('singleton_id'),
  textRequired('installation_id'),
  textRequired('location_id'),
  textRequired('configured_at'),
  textRequired('configured_by'),
  textRequired('updated_at'),
  textRequired('updated_by'),
  integerRequired('row_version')
])

const requiredForeignKeys = Object.freeze([
  foreignKey(
    'installation_location_configuration',
    'installation_id',
    'installation',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey(
    'installation_location_configuration',
    'location_id',
    'locations',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey(
    'installation_location_configuration',
    'configured_by',
    'users',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey(
    'installation_location_configuration',
    'updated_by',
    'users',
    'id',
    'RESTRICT',
    'RESTRICT'
  )
])

const requiredIndexDefinitions = Object.freeze([
  indexContract(
    'ux_installation_location_configuration_installation',
    'installation_location_configuration',
    [indexColumn('installation_id', false)],
    true
  ),
  indexContract(
    'ix_installation_location_configuration_location',
    'installation_location_configuration',
    [indexColumn('location_id', false)]
  )
])

const requiredConfigurationTableSqlSnippets = Object.freeze([
  'singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1)',
  'installation_id TEXT NOT NULL',
  'location_id TEXT NOT NULL',
  'configured_at TEXT NOT NULL',
  'configured_by TEXT NOT NULL',
  'updated_at TEXT NOT NULL',
  'updated_by TEXT NOT NULL',
  'row_version INTEGER NOT NULL CHECK (row_version >= 1)',
  'CONSTRAINT ck_installation_location_configuration_updated_at CHECK (updated_at >= configured_at)',
  'CONSTRAINT fk_installation_location_configuration_installation FOREIGN KEY (installation_id) REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  'CONSTRAINT fk_installation_location_configuration_location FOREIGN KEY (location_id) REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  'CONSTRAINT fk_installation_location_configuration_configured_by FOREIGN KEY (configured_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
  'CONSTRAINT fk_installation_location_configuration_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT'
])

export const schemaVersion6TableContracts = Object.freeze(
  [...schemaVersion5TableContracts, installationLocationConfigurationTable].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
)

export const schemaVersion6TableNames = Object.freeze(
  [...schemaVersion5TableNames, 'installation_location_configuration'].sort()
)

export const schemaVersion6TriggerNames = schemaVersion5TriggerNames

export const schemaVersion6NamedIndexes = Object.freeze(
  [
    ...schemaVersion5NamedIndexes,
    'ix_installation_location_configuration_location',
    'ux_installation_location_configuration_installation'
  ].sort()
)

export function validateSchemaVersion6(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (
    !isSchemaVersion6Valid(connection, { requireForeignKeyEnforcement: mode === 'compatibility' })
  ) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion6Valid(
  connection: MigrationConnection,
  options: { readonly requireForeignKeyEnforcement: boolean }
): boolean {
  try {
    return (
      hasRequiredSchemaVersion5Invariants(connection, {
        requireForeignKeyEnforcement: options.requireForeignKeyEnforcement,
        namedIndexes: schemaVersion6NamedIndexes,
        tableNames: schemaVersion6TableNames
      }) &&
      hasExactTableNames(connection) &&
      hasExactNamedIndexes(connection) &&
      hasExactTriggerNames(connection) &&
      hasExactConfigurationColumns(connection) &&
      hasRequiredConfigurationForeignKeys(connection) &&
      hasRequiredConfigurationIndexes(connection) &&
      hasRequiredConfigurationTableSql(connection)
    )
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion6TableNames)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion6NamedIndexes)
}

function hasExactTriggerNames(connection: MigrationConnection): boolean {
  return arraysEqual(readTriggerNames(connection), schemaVersion6TriggerNames)
}

function hasExactConfigurationColumns(connection: MigrationConnection): boolean {
  return columnsMatch(
    readTableColumns(connection, 'installation_location_configuration'),
    installationLocationConfigurationTable.columns
  )
}

function hasRequiredConfigurationForeignKeys(connection: MigrationConnection): boolean {
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

function hasRequiredConfigurationIndexes(connection: MigrationConnection): boolean {
  return requiredIndexDefinitions.every((expected) => {
    const actualIndex = readTableIndexes(connection, expected.tableName).find(
      (candidate) => candidate.name === expected.name
    )

    return (
      actualIndex !== undefined &&
      actualIndex.unique === expected.unique &&
      indexColumnsEqual(readIndexKeyColumns(connection, expected.name), expected.columns)
    )
  })
}

function hasRequiredConfigurationTableSql(connection: MigrationConnection): boolean {
  const sql = normalizeSchemaSql(
    readCreateSql(connection, 'table', 'installation_location_configuration')
  )

  return requiredConfigurationTableSqlSnippets.every((snippet) =>
    sql.includes(normalizeSchemaSql(snippet))
  )
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
  ).map((row) =>
    foreignKey(
      tableName,
      String(row.from),
      String(row.table),
      String(row.to),
      String(row.on_update),
      String(row.on_delete)
    )
  )
}

function readTableIndexes(
  connection: MigrationConnection,
  tableName: string
): ReadonlyArray<{ name: string; unique: boolean }> {
  return (
    connection
      .prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
      .all() as SqliteIndexListRow[]
  ).map((row) => ({
    name: String(row.name),
    unique: Number(row.unique) === 1
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

function readCreateSql(connection: MigrationConnection, objectType: 'table', name: string): string {
  const row = connection
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(objectType, name) as SqliteSqlRow | undefined

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

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({
    name,
    columns: Object.freeze([...columns])
  })
}

function integerPk(name: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 0, 1)
}

function textRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 1, 0)
}

function integerRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 1, 0)
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

function foreignKey(
  tableName: string,
  from: string,
  toTable: string,
  to: string,
  onUpdate: string,
  onDelete: string
): ForeignKeyContract {
  return Object.freeze({
    tableName,
    from,
    toTable,
    to,
    onUpdate,
    onDelete
  })
}

function indexContract(
  name: string,
  tableName: string,
  columns: readonly IndexColumnContract[],
  unique = false
): IndexContract {
  return Object.freeze({
    name,
    tableName,
    unique,
    columns: Object.freeze([...columns])
  })
}

function indexColumn(name: string, descending: boolean): IndexColumnContract {
  return Object.freeze({ name, descending })
}

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  )
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
