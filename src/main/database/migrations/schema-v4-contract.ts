import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  createSchemaMigrationsTableSql,
  type SchemaVersion1ColumnContract,
  type SchemaVersion1TableContract
} from './schema-v1-contract'
import {
  hasRequiredSchemaVersion3PatientAmendmentInvariants,
  schemaVersion3NamedIndexes,
  schemaVersion3TableContracts,
  schemaVersion3TriggerNames
} from './schema-v3-contract'

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
  cid: unknown
  name: unknown
  desc: unknown
  key: unknown
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

const textPk = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 1)
const textRequired = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 0)
const textOptional = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 0, 0)
const integerRequired = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 1, 0)
const integerOptional = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 0, 0)

const screeningSessionV4Columns = Object.freeze([
  textPk('id'),
  textRequired('location_id'),
  textRequired('protocol_version_id'),
  textRequired('session_date'),
  textRequired('status'),
  textOptional('notes'),
  textRequired('opened_by'),
  textRequired('opened_at'),
  textOptional('closed_by'),
  textOptional('closed_at'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at'),
  integerRequired('row_version')
])

const lifecycleHistoryTable = table('screening_session_lifecycle_history', [
  textPk('id'),
  textRequired('screening_session_id'),
  textRequired('transition_type'),
  textOptional('from_status'),
  textRequired('to_status'),
  textOptional('reason'),
  textRequired('changed_by'),
  textRequired('changed_at'),
  integerOptional('prior_row_version'),
  integerRequired('resulting_row_version')
])

const requiredForeignKeys = Object.freeze([
  foreignKey('screening_sessions', 'location_id', 'locations', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey(
    'screening_sessions',
    'protocol_version_id',
    'protocol_versions',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey('screening_sessions', 'opened_by', 'users', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey('screening_sessions', 'closed_by', 'users', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey('screening_sessions', 'created_by', 'users', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey('screening_sessions', 'updated_by', 'users', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey(
    'screening_session_lifecycle_history',
    'screening_session_id',
    'screening_sessions',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey(
    'screening_session_lifecycle_history',
    'changed_by',
    'users',
    'id',
    'RESTRICT',
    'RESTRICT'
  )
])

const requiredIndexDefinitions = Object.freeze([
  indexContract(
    'ux_screening_sessions_location_date',
    'screening_sessions',
    [indexColumn('location_id', false), indexColumn('session_date', false)],
    true
  ),
  indexContract('ix_screening_sessions_date_status', 'screening_sessions', [
    indexColumn('session_date', true),
    indexColumn('status', false),
    indexColumn('id', true)
  ]),
  indexContract('ix_screening_sessions_location_date_status', 'screening_sessions', [
    indexColumn('location_id', false),
    indexColumn('session_date', true),
    indexColumn('status', false),
    indexColumn('id', true)
  ]),
  indexContract(
    'ix_screening_session_lifecycle_history_session_time',
    'screening_session_lifecycle_history',
    [
      indexColumn('screening_session_id', false),
      indexColumn('changed_at', false),
      indexColumn('id', false)
    ]
  ),
  indexContract(
    'ix_screening_session_lifecycle_history_changed_at',
    'screening_session_lifecycle_history',
    [indexColumn('changed_at', true), indexColumn('id', true)]
  )
])

const requiredTableSqlSnippets = Object.freeze(
  new Map([
    [
      'screening_sessions',
      [
        'id TEXT PRIMARY KEY',
        'location_id TEXT NOT NULL',
        'protocol_version_id TEXT NOT NULL',
        'session_date TEXT NOT NULL',
        "status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED'))",
        'notes TEXT NULL CHECK (notes IS NULL OR length(notes) <= 500)',
        'opened_by TEXT NOT NULL',
        'opened_at TEXT NOT NULL',
        'closed_by TEXT NULL',
        'closed_at TEXT NULL',
        'created_by TEXT NOT NULL',
        'created_at TEXT NOT NULL',
        'updated_by TEXT NOT NULL',
        'updated_at TEXT NOT NULL',
        'row_version INTEGER NOT NULL CHECK (row_version >= 1)',
        'CONSTRAINT ck_screening_sessions_current_status_state',
        "status = 'OPEN'",
        'closed_by IS NULL',
        'closed_at IS NULL',
        "status = 'CLOSED'",
        'closed_by IS NOT NULL',
        'closed_at IS NOT NULL',
        'CONSTRAINT fk_screening_sessions_opened_by FOREIGN KEY (opened_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
        'CONSTRAINT fk_screening_sessions_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT'
      ]
    ],
    [
      'screening_session_lifecycle_history',
      [
        'id TEXT PRIMARY KEY',
        'screening_session_id TEXT NOT NULL',
        "transition_type IN ('CREATED', 'CLOSED', 'REOPENED')",
        "from_status IS NULL OR from_status IN ('OPEN', 'CLOSED')",
        "to_status TEXT NOT NULL CHECK (to_status IN ('OPEN', 'CLOSED'))",
        'reason TEXT NULL CHECK (reason IS NULL OR length(reason) <= 500)',
        'changed_by TEXT NOT NULL',
        'changed_at TEXT NOT NULL',
        'prior_row_version INTEGER NULL CHECK ( prior_row_version IS NULL OR prior_row_version >= 1 )',
        'resulting_row_version INTEGER NOT NULL CHECK (resulting_row_version >= 1)',
        "transition_type = 'CREATED'",
        'from_status IS NULL',
        "to_status = 'OPEN'",
        'reason IS NULL',
        'prior_row_version IS NULL',
        'resulting_row_version = 1',
        "transition_type = 'CLOSED'",
        "from_status = 'OPEN'",
        "to_status = 'CLOSED'",
        'resulting_row_version = prior_row_version + 1',
        "transition_type = 'REOPENED'",
        "from_status = 'CLOSED'",
        "to_status = 'OPEN'",
        'reason IS NOT NULL',
        'length(trim(reason)) > 0',
        'CONSTRAINT fk_screening_session_lifecycle_history_session FOREIGN KEY (screening_session_id) REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
        'CONSTRAINT fk_screening_session_lifecycle_history_changed_by FOREIGN KEY (changed_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT'
      ]
    ]
  ])
)

export const schemaVersion4TableContracts = Object.freeze(
  [
    ...schemaVersion3TableContracts.map((contract) => {
      if (contract.name === 'screening_sessions') {
        return table('screening_sessions', screeningSessionV4Columns)
      }

      return contract
    }),
    lifecycleHistoryTable
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion4TableNames = Object.freeze(
  schemaVersion4TableContracts.map((contract) => contract.name)
)

export const schemaVersion4NamedIndexes = Object.freeze(
  [
    ...schemaVersion3NamedIndexes,
    'ix_screening_session_lifecycle_history_changed_at',
    'ix_screening_session_lifecycle_history_session_time',
    'ix_screening_sessions_date_status',
    'ix_screening_sessions_location_date_status'
  ].sort()
)

export const schemaVersion4TriggerNames = schemaVersion3TriggerNames

export function validateSchemaVersion4(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (
    !isSchemaVersion4Valid(connection, { requireForeignKeyEnforcement: mode === 'compatibility' })
  ) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

export function hasRequiredSchemaVersion4Invariants(
  connection: MigrationConnection,
  options: {
    readonly requireForeignKeyEnforcement: boolean
    readonly namedIndexes?: readonly string[]
  }
): boolean {
  try {
    return (
      (!options.requireForeignKeyEnforcement || isForeignKeyEnforcementEnabled(connection)) &&
      hasExactTableNames(connection) &&
      hasExactStrictTables(connection) &&
      hasExactNamedIndexes(connection, options.namedIndexes ?? schemaVersion4NamedIndexes) &&
      hasExactTriggerNames(connection) &&
      hasExactColumns(connection) &&
      hasExactSchemaMigrationsSql(connection) &&
      hasRequiredSchemaVersion3PatientAmendmentInvariants(connection) &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredIndexDefinitions(connection) &&
      hasNoGlobalOpenSessionUniqueIndex(connection) &&
      hasRequiredTableSql(connection)
    )
  } catch {
    return false
  }
}

function isSchemaVersion4Valid(
  connection: MigrationConnection,
  options: { requireForeignKeyEnforcement: boolean }
): boolean {
  return hasRequiredSchemaVersion4Invariants(connection, options)
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion4TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    readTableList(connection)
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [row.name, row.strict])
  )

  return schemaVersion4TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(
  connection: MigrationConnection,
  expectedNames: readonly string[]
): boolean {
  return arraysEqual(readNamedIndexNames(connection), expectedNames)
}

function hasExactTriggerNames(connection: MigrationConnection): boolean {
  return arraysEqual(readTriggerNames(connection), schemaVersion4TriggerNames)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion4TableContracts.every((tableContract) =>
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

function hasRequiredIndexDefinitions(connection: MigrationConnection): boolean {
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

function hasNoGlobalOpenSessionUniqueIndex(connection: MigrationConnection): boolean {
  return !readIndexSqlForTable(connection, 'screening_sessions').some((sql) => {
    const normalized = normalizeSchemaSql(sql).toUpperCase()

    return (
      normalized.includes('WHERE STATUS =') &&
      normalized.includes("'OPEN'") &&
      normalized.includes('UNIQUE')
    )
  })
}

function hasRequiredTableSql(connection: MigrationConnection): boolean {
  return [...requiredTableSqlSnippets.entries()].every(([tableName, snippets]) => {
    const sql = normalizeSchemaSql(readCreateSql(connection, 'table', tableName))

    return snippets.every((snippet) => sql.includes(normalizeSchemaSql(snippet)))
  })
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

function readIndexSqlForTable(
  connection: MigrationConnection,
  tableName: string
): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = ?
           AND sql IS NOT NULL`
      )
      .all(tableName) as SqliteSqlRow[]
  )
    .map((row) => row.sql)
    .filter((sql): sql is string => typeof sql === 'string')
}

function readCreateSql(
  connection: MigrationConnection,
  objectType: 'table' | 'trigger',
  name: string
): string {
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
