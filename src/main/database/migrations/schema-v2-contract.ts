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
  type SchemaVersion1ColumnContract
} from './schema-v1-contract'

type SqliteStorageType = 'INTEGER' | 'TEXT'

const requiredSchemaVersion2Indexes = Object.freeze([
  'ix_patients_approximate_age',
  'ix_patients_code_name',
  'ix_patients_date_of_birth',
  'ix_patients_residence_search',
  'ux_patient_identifiers_active_local_code'
])

const requiredSchemaVersion2Triggers = Object.freeze([
  'patients_hsd025_identity_insert',
  'patients_hsd025_identity_update'
])

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
      hasSchemaVersion1BaseContract(connection) &&
      hasStrictLocalSequencesTable(connection) &&
      hasPatientCodeSequenceRow(connection) &&
      hasPatientIdentifierStatusColumn(connection) &&
      hasRequiredIndexes(connection) &&
      hasRequiredTriggers(connection)
    )
  } catch {
    return false
  }
}

function hasStrictLocalSequencesTable(connection: MigrationConnection): boolean {
  const row = connection
    .prepare('PRAGMA table_list')
    .all()
    .find((candidate) => {
      const value = candidate as { schema?: unknown; name?: unknown; type?: unknown }
      return value.schema === 'main' && value.name === 'local_sequences' && value.type === 'table'
    }) as { strict?: unknown } | undefined

  if (row?.strict !== 1) {
    return false
  }

  const columns = connection.prepare('PRAGMA table_xinfo(local_sequences)').all() as Array<{
    name: unknown
    type: unknown
    notnull: unknown
    pk: unknown
  }>

  return (
    columns.length === 3 &&
    columns[0]?.name === 'key' &&
    columns[0]?.type === 'TEXT' &&
    columns[0]?.notnull === 1 &&
    columns[0]?.pk === 1 &&
    columns[1]?.name === 'next_value' &&
    columns[1]?.type === 'INTEGER' &&
    columns[1]?.notnull === 1 &&
    columns[2]?.name === 'updated_at' &&
    columns[2]?.type === 'TEXT' &&
    columns[2]?.notnull === 1
  )
}

function hasPatientCodeSequenceRow(connection: MigrationConnection): boolean {
  const row = connection
    .prepare("SELECT next_value FROM local_sequences WHERE key = 'patient_code'")
    .get() as { next_value?: unknown } | undefined

  return (
    typeof row?.next_value === 'number' && Number.isInteger(row.next_value) && row.next_value >= 1
  )
}

function hasPatientIdentifierStatusColumn(connection: MigrationConnection): boolean {
  const columns = connection.prepare('PRAGMA table_xinfo(patient_identifiers)').all() as Array<{
    name: unknown
    type: unknown
  }>

  return columns.some((column) => column.name === 'status' && column.type === 'TEXT')
}

function hasRequiredIndexes(connection: MigrationConnection): boolean {
  const names = new Set(readObjectNames(connection, 'index'))

  return requiredSchemaVersion2Indexes.every((name) => names.has(name))
}

function hasRequiredTriggers(connection: MigrationConnection): boolean {
  const names = new Set(readObjectNames(connection, 'trigger'))

  return requiredSchemaVersion2Triggers.every((name) => names.has(name))
}

function readObjectNames(
  connection: MigrationConnection,
  type: 'index' | 'trigger'
): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = ?
         ORDER BY name`
      )
      .all(type) as Array<{ name: unknown }>
  ).map((row) => String(row.name))
}

export function validateFreshSchemaVersion2(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  validateSchemaVersion2(connection, mode)
}

function hasSchemaVersion1BaseContract(connection: MigrationConnection): boolean {
  return (
    connection.pragma('foreign_keys', { simple: true }) === 1 &&
    hasRequiredSchemaVersion1StrictTables(connection) &&
    hasRequiredSchemaVersion1Indexes(connection) &&
    hasSchemaVersion2CompatibleColumns(connection) &&
    hasExactSchemaMigrationsSql(connection)
  )
}

function hasRequiredSchemaVersion1StrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    (
      connection.prepare('PRAGMA table_list').all() as Array<{
        schema: unknown
        name: unknown
        type: unknown
        strict: unknown
      }>
    )
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [String(row.name), Number(row.strict)])
  )

  return schemaVersion1TableContracts.every((contract) => strictTables.get(contract.name) === 1)
}

function hasRequiredSchemaVersion1Indexes(connection: MigrationConnection): boolean {
  const names = new Set(readObjectNames(connection, 'index'))

  return schemaVersion1NamedIndexes.every((name) => names.has(name))
}

function hasSchemaVersion2CompatibleColumns(connection: MigrationConnection): boolean {
  return schemaVersion1TableContracts.every((tableContract) =>
    columnsMatch(
      readTableColumns(connection, tableContract.name),
      tableContract.name === 'patient_identifiers'
        ? [
            ...tableContract.columns,
            {
              name: 'status',
              type: 'TEXT',
              notNull: 0,
              primaryKey: 0,
              defaultValue: null,
              hidden: 0
            } satisfies SchemaVersion1ColumnContract
          ]
        : tableContract.columns
    )
  )
}

function hasExactSchemaMigrationsSql(connection: MigrationConnection): boolean {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('schema_migrations') as { sql?: unknown } | undefined

  return (
    typeof row?.sql === 'string' &&
    normalizeSchemaSql(row.sql) === normalizeSchemaSql(createSchemaMigrationsTableSql)
  )
}

function readTableColumns(
  connection: MigrationConnection,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
  return (
    connection.prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`).all() as Array<{
      name: unknown
      type: unknown
      notnull: unknown
      dflt_value: unknown
      pk: unknown
      hidden: unknown
    }>
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}
