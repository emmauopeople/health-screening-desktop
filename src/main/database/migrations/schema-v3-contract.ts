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
import { schemaVersion2NamedIndexes, schemaVersion2TableContracts } from './schema-v2-contract'

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

interface SqliteIndexInfoRow {
  name: unknown
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
const textCompositePk = (name: string, primaryKey: number): SchemaVersion1ColumnContract =>
  column(name, 'TEXT', 1, primaryKey)
const textRequired = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 0)
const textOptional = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 0, 0)
const integerRequired = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 1, 0)
const integerOptional = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 0, 0)

const consentRecordV3Columns = appendColumns(getVersion2Columns('consent_records'), [
  integerOptional('patient_prior_row_version'),
  integerOptional('patient_resulting_row_version')
])

const hsd026Tables = Object.freeze([
  table('patient_demographic_amendment_changes', [
    textCompositePk('amendment_id', 1),
    textCompositePk('field_name', 2),
    textRequired('previous_value_json'),
    textRequired('new_value_json')
  ]),
  table('patient_demographic_amendments', [
    textPk('id'),
    textRequired('patient_id'),
    integerRequired('prior_row_version'),
    integerRequired('resulting_row_version'),
    textRequired('reason_code'),
    textOptional('reason_note'),
    textRequired('amended_by'),
    textRequired('amended_at')
  ])
])

const requiredForeignKeys = Object.freeze([
  foreignKey(
    'patient_demographic_amendments',
    'patient_id',
    'patients',
    'id',
    'RESTRICT',
    'RESTRICT'
  ),
  foreignKey('patient_demographic_amendments', 'amended_by', 'users', 'id', 'RESTRICT', 'RESTRICT'),
  foreignKey(
    'patient_demographic_amendment_changes',
    'amendment_id',
    'patient_demographic_amendments',
    'id',
    'RESTRICT',
    'RESTRICT'
  )
])

const requiredIndexDefinitions = Object.freeze([
  indexContract(
    'ix_patient_demographic_amendments_patient_time',
    'patient_demographic_amendments',
    [indexColumn('patient_id', false), indexColumn('amended_at', true), indexColumn('id', true)]
  ),
  indexContract(
    'ix_patient_demographic_amendment_changes_field',
    'patient_demographic_amendment_changes',
    [indexColumn('field_name', false), indexColumn('amendment_id', false)]
  ),
  indexContract('ix_consent_records_registry_ack_history', 'consent_records', [
    indexColumn('patient_id', false),
    indexColumn('consent_type', false),
    indexColumn('recorded_at', true),
    indexColumn('id', true)
  ])
])

const requiredTriggerSqlSnippets = Object.freeze(
  new Map([
    [
      'tr_patient_demographic_amendments_no_update',
      [
        'BEFORE UPDATE ON patient_demographic_amendments',
        "RAISE(ABORT, 'patient demographic amendments are append-only')"
      ]
    ],
    [
      'tr_patient_demographic_amendments_no_delete',
      [
        'BEFORE DELETE ON patient_demographic_amendments',
        "RAISE(ABORT, 'patient demographic amendments are append-only')"
      ]
    ],
    [
      'tr_patient_demographic_amendment_changes_no_update',
      [
        'BEFORE UPDATE ON patient_demographic_amendment_changes',
        "RAISE(ABORT, 'patient demographic amendment changes are append-only')"
      ]
    ],
    [
      'tr_patient_demographic_amendment_changes_no_delete',
      [
        'BEFORE DELETE ON patient_demographic_amendment_changes',
        "RAISE(ABORT, 'patient demographic amendment changes are append-only')"
      ]
    ],
    [
      'tr_consent_records_registry_acknowledgment_no_update',
      [
        'BEFORE UPDATE ON consent_records',
        "WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT' OR NEW.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'",
        "RAISE(ABORT, 'registry acknowledgment records are append-only')"
      ]
    ],
    [
      'tr_consent_records_registry_acknowledgment_no_delete',
      [
        'BEFORE DELETE ON consent_records',
        "WHEN OLD.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'",
        "RAISE(ABORT, 'registry acknowledgment records are append-only')"
      ]
    ]
  ])
)

const requiredTableSqlSnippets = Object.freeze(
  new Map([
    [
      'patient_demographic_amendments',
      [
        'id TEXT PRIMARY KEY',
        'patient_id TEXT NOT NULL',
        'prior_row_version INTEGER NOT NULL CHECK (prior_row_version >= 1)',
        'resulting_row_version INTEGER NOT NULL CHECK ( resulting_row_version = prior_row_version + 1 )',
        "'DATA_ENTRY_CORRECTION'",
        "'PATIENT_REPORTED_CHANGE'",
        "'CONTACT_INFORMATION_UPDATE'",
        "'RESIDENCE_INFORMATION_UPDATE'",
        "'STATUS_CHANGE'",
        "'OTHER'",
        'reason_note TEXT NULL CHECK (reason_note IS NULL OR length(reason_note) <= 500)',
        'amended_by TEXT NOT NULL',
        'amended_at TEXT NOT NULL',
        "CONSTRAINT ck_patient_demographic_amendments_other_note CHECK ( reason_code <> 'OTHER' OR (reason_note IS NOT NULL AND length(trim(reason_note)) > 0) )",
        'CONSTRAINT ux_patient_demographic_amendments_patient_resulting_row_version UNIQUE (patient_id, resulting_row_version)',
        'CONSTRAINT fk_patient_demographic_amendments_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
        'CONSTRAINT fk_patient_demographic_amendments_amended_by FOREIGN KEY (amended_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT'
      ]
    ],
    [
      'patient_demographic_amendment_changes',
      [
        'amendment_id TEXT NOT NULL',
        'field_name TEXT NOT NULL CHECK',
        "'given_name'",
        "'family_name'",
        "'other_names'",
        "'date_of_birth'",
        "'approximate_age_years'",
        "'age_as_of_date'",
        "'sex'",
        "'village'",
        "'quarter'",
        "'phone'",
        "'alternate_contact_name'",
        "'alternate_contact_phone'",
        "'residence_notes'",
        "'status'",
        "json_type(previous_value_json) IN ('null', 'integer', 'real', 'text')",
        "json_type(new_value_json) IN ('null', 'integer', 'real', 'text')",
        'CONSTRAINT ck_patient_demographic_amendment_changes_distinct_values CHECK (previous_value_json <> new_value_json)',
        'CONSTRAINT fk_patient_demographic_amendment_changes_amendment FOREIGN KEY (amendment_id) REFERENCES patient_demographic_amendments (id) ON UPDATE RESTRICT ON DELETE RESTRICT'
      ]
    ],
    [
      'consent_records',
      [
        'patient_prior_row_version INTEGER NULL CHECK ( patient_prior_row_version IS NULL OR patient_prior_row_version >= 1 )',
        'patient_resulting_row_version INTEGER NULL CHECK ( patient_resulting_row_version IS NULL OR patient_resulting_row_version >= 2 ) CHECK ( ( patient_prior_row_version IS NULL AND patient_resulting_row_version IS NULL ) OR ( patient_prior_row_version IS NOT NULL AND patient_resulting_row_version IS NOT NULL AND patient_resulting_row_version = patient_prior_row_version + 1 ) )'
      ]
    ]
  ])
)

export const schemaVersion3TableContracts = Object.freeze(
  [
    ...schemaVersion2TableContracts.map((contract) => {
      if (contract.name === 'consent_records') {
        return table('consent_records', consentRecordV3Columns)
      }

      return contract
    }),
    ...hsd026Tables
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion3TableNames = Object.freeze(
  schemaVersion3TableContracts.map((contract) => contract.name)
)

export const schemaVersion3NamedIndexes = Object.freeze(
  [
    ...schemaVersion2NamedIndexes,
    'ix_consent_records_registry_ack_history',
    'ix_patient_demographic_amendment_changes_field',
    'ix_patient_demographic_amendments_patient_time'
  ].sort()
)

export const schemaVersion3TriggerNames = Object.freeze(
  [...requiredTriggerSqlSnippets.keys()].sort()
)

export function validateSchemaVersion3(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion3Valid(connection)) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion3Valid(connection: MigrationConnection): boolean {
  try {
    return (
      isForeignKeyEnforcementEnabled(connection) &&
      hasExactTableNames(connection) &&
      hasExactStrictTables(connection) &&
      hasExactNamedIndexes(connection) &&
      hasExactTriggerNames(connection) &&
      hasExactColumns(connection) &&
      hasExactSchemaMigrationsSql(connection) &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredUniqueConstraint(connection) &&
      hasRequiredIndexDefinitions(connection) &&
      hasRequiredTableSql(connection) &&
      hasRequiredTriggerSql(connection)
    )
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion3TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    readTableList(connection)
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [row.name, row.strict])
  )

  return schemaVersion3TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion3NamedIndexes)
}

function hasExactTriggerNames(connection: MigrationConnection): boolean {
  return arraysEqual(readTriggerNames(connection), schemaVersion3TriggerNames)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion3TableContracts.every((tableContract) =>
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

function hasRequiredUniqueConstraint(connection: MigrationConnection): boolean {
  return readUniqueIndexes(connection, 'patient_demographic_amendments').some((indexName) =>
    arraysEqual(readIndexColumns(connection, indexName), ['patient_id', 'resulting_row_version'])
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

function hasRequiredTableSql(connection: MigrationConnection): boolean {
  return [...requiredTableSqlSnippets.entries()].every(([tableName, snippets]) => {
    const sql = normalizeSchemaSql(readCreateSql(connection, 'table', tableName))

    return snippets.every((snippet) => sql.includes(normalizeSchemaSql(snippet)))
  })
}

function hasRequiredTriggerSql(connection: MigrationConnection): boolean {
  return [...requiredTriggerSqlSnippets.entries()].every(([triggerName, snippets]) => {
    const sql = normalizeSchemaSql(readCreateSql(connection, 'trigger', triggerName))

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

function readUniqueIndexes(connection: MigrationConnection, tableName: string): readonly string[] {
  return (
    connection
      .prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
      .all() as SqliteIndexListRow[]
  )
    .filter((row) => Number(row.unique) === 1)
    .map((row) => String(row.name))
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

function readIndexColumns(connection: MigrationConnection, indexName: string): readonly string[] {
  return (
    connection
      .prepare(`PRAGMA index_info(${quoteIdentifier(indexName)})`)
      .all() as SqliteIndexInfoRow[]
  ).map((row) => String(row.name))
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

function getVersion2Columns(tableName: string): readonly SchemaVersion1ColumnContract[] {
  const contract = schemaVersion2TableContracts.find((candidate) => candidate.name === tableName)

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
