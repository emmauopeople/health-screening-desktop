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
  schemaVersion18NamedIndexes,
  schemaVersion18TableContracts,
  schemaVersion18TableNames,
  schemaVersion18TriggerNames
} from './schema-v18-contract'

const batchesTable = table('sync_transport_batches', [
  textPk('id'),
  textRequired('request_json'),
  textRequired('request_sha256'),
  textRequired('status'),
  integerRequired('attempt_count', '0'),
  textRequired('created_at'),
  textOptional('next_attempt_at'),
  textOptional('lease_expires_at'),
  textOptional('active_attempt_id'),
  textOptional('last_error_code'),
  textOptional('completed_at')
])
const itemsTable = table('sync_transport_batch_items', [
  textPk('batch_id'),
  textRequired('outbox_id'),
  integerPk('sequence_number', 2)
])

export const schemaVersion19TableContracts = Object.freeze(
  [...schemaVersion18TableContracts, batchesTable, itemsTable].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
)
export const schemaVersion19TableNames = Object.freeze(
  [...schemaVersion18TableNames, 'sync_transport_batches', 'sync_transport_batch_items'].sort()
)
export const schemaVersion19NamedIndexes = Object.freeze(
  [...schemaVersion18NamedIndexes, 'ix_sync_transport_batches_ready'].sort()
)
export const schemaVersion19TriggerNames = Object.freeze(
  [...schemaVersion18TriggerNames, 'tr_sync_transport_batches_request_immutable'].sort()
)

export function validateSchemaVersion19(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isValid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isValid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readNames(connection, 'table'), schemaVersion19TableNames) &&
      arraysEqual(readNames(connection, 'index'), schemaVersion19NamedIndexes) &&
      arraysEqual(readNames(connection, 'trigger'), schemaVersion19TriggerNames) &&
      schemaVersion19TableNames.every((name) => strictTables(connection).get(name) === 1) &&
      schemaVersion19TableContracts.every((contract) =>
        columnsEqual(readColumns(connection, contract.name), contract.columns)
      ) &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredSql(connection)
    )
  } catch {
    return false
  }
}

function hasRequiredForeignKeys(connection: MigrationConnection): boolean {
  const items = connection.prepare('PRAGMA foreign_key_list("sync_transport_batch_items")').all()
  const batches = connection.prepare('PRAGMA foreign_key_list("sync_transport_batches")').all()
  const encoded = JSON.stringify({ items, batches })
  return (
    encoded.includes('sync_transport_batches') &&
    encoded.includes('sync_outbox') &&
    encoded.includes('sync_attempts')
  )
}

function hasRequiredSql(connection: MigrationConnection): boolean {
  const tableSql = readSql(connection, 'table', 'sync_transport_batches')
  const triggerSql = readSql(connection, 'trigger', 'tr_sync_transport_batches_request_immutable')
  return (
    tableSql.includes("'PREPARED', 'IN_FLIGHT', 'RETRY_WAIT', 'COMPLETED'") &&
    tableSql.includes('ck_sync_transport_batches_state') &&
    triggerSql.includes('sync transport request is immutable')
  )
}

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({ name, columns: Object.freeze([...columns]) })
}

function column(
  name: string,
  type: 'TEXT' | 'INTEGER',
  notNull: 0 | 1,
  primaryKey: number,
  defaultValue: string | null = null
): SchemaVersion1ColumnContract {
  return Object.freeze({ name, type, notNull, primaryKey, defaultValue, hidden: 0 })
}

function textPk(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 1, 1)
}
function integerPk(name: string, order: number): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 1, order)
}
function textRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 1, 0)
}
function textOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'TEXT', 0, 0)
}
function integerRequired(name: string, defaultValue: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 1, 0, defaultValue)
}

function readNames(
  connection: MigrationConnection,
  type: 'table' | 'index' | 'trigger'
): readonly string[] {
  const filter = type === 'trigger' ? '' : " AND name NOT LIKE 'sqlite_%'"
  return (
    connection
      .prepare(`SELECT name FROM sqlite_master WHERE type=?${filter} ORDER BY name`)
      .all(type) as readonly { name: unknown }[]
  ).map((row) => String(row.name))
}

function strictTables(connection: MigrationConnection): ReadonlyMap<string, number> {
  return new Map(
    (
      connection.prepare('PRAGMA table_list').all() as readonly {
        schema: unknown
        name: unknown
        type: unknown
        strict: unknown
      }[]
    )
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [String(row.name), Number(row.strict)])
  )
}

function readColumns(
  connection: MigrationConnection,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
  return (
    connection.prepare(`PRAGMA table_xinfo("${tableName}")`).all() as readonly {
      name: unknown
      type: unknown
      notnull: unknown
      dflt_value: unknown
      pk: unknown
      hidden: unknown
    }[]
  ).map((row) => ({
    name: String(row.name),
    type: String(row.type) as 'TEXT' | 'INTEGER' | 'REAL',
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function readSql(connection: MigrationConnection, type: 'table' | 'trigger', name: string): string {
  const row = connection
    .prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
    .get(type, name) as { sql?: unknown } | undefined
  return typeof row?.sql === 'string' ? row.sql : ''
}

function columnsEqual(
  actual: readonly SchemaVersion1ColumnContract[],
  expected: readonly SchemaVersion1ColumnContract[]
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}
function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
