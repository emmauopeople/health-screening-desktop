import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  schemaVersion19NamedIndexes,
  schemaVersion19TableNames,
  schemaVersion19TriggerNames
} from './schema-v19-contract'

const addedTables = Object.freeze(['sync_transport_resource_mappings'])

export const schemaVersion20TableNames = Object.freeze(
  [...schemaVersion19TableNames, ...addedTables].sort()
)
export const schemaVersion20NamedIndexes = Object.freeze(
  [
    ...schemaVersion19NamedIndexes,
    'ix_sync_transport_batch_items_outbox_history',
    'ux_sync_transport_resource_mappings_canonical'
  ].sort()
)
export const schemaVersion20TriggerNames = Object.freeze(
  [...schemaVersion19TriggerNames, 'tr_sync_transport_batches_response_immutable'].sort()
)

export function validateSchemaVersion20(
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
    const batchColumns = readColumns(connection, 'sync_transport_batches')
    const itemIndexes = readIndexNames(connection, 'sync_transport_batch_items')
    return (
      arraysEqual(readNames(connection, 'table'), schemaVersion20TableNames) &&
      arraysEqual(readNames(connection, 'index'), schemaVersion20NamedIndexes) &&
      arraysEqual(readNames(connection, 'trigger'), schemaVersion20TriggerNames) &&
      schemaVersion20TableNames.every((name) => strictTables(connection).get(name) === 1) &&
      batchColumns.includes('response_json') &&
      batchColumns.includes('response_sha256') &&
      itemIndexes.includes('sqlite_autoindex_sync_transport_batch_items_2') &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredSql(connection)
    )
  } catch {
    return false
  }
}

function hasRequiredForeignKeys(connection: MigrationConnection): boolean {
  const encoded = JSON.stringify({
    items: connection.prepare('PRAGMA foreign_key_list("sync_transport_batch_items")').all()
  })
  return encoded.includes('sync_transport_batches') && encoded.includes('sync_outbox')
}

function hasRequiredSql(connection: MigrationConnection): boolean {
  const triggerSql = readSql(connection, 'trigger', 'tr_sync_transport_batches_response_immutable')
  const batchSql = readSql(connection, 'table', 'sync_transport_batches')
  const itemSql = readSql(connection, 'table', 'sync_transport_batch_items')
  return (
    triggerSql.includes('sync transport response is immutable') &&
    batchSql.includes('response_json IS NULL AND response_sha256 IS NULL') &&
    batchSql.includes('response_json IS NOT NULL') &&
    !itemSql.includes('outbox_id TEXT NOT NULL UNIQUE') &&
    itemSql.includes('ux_sync_transport_batch_items_batch_outbox')
  )
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

function readColumns(connection: MigrationConnection, tableName: string): readonly string[] {
  return (
    connection.prepare(`PRAGMA table_xinfo("${tableName}")`).all() as readonly { name: unknown }[]
  ).map((row) => String(row.name))
}

function readIndexNames(connection: MigrationConnection, tableName: string): readonly string[] {
  return (
    connection.prepare(`PRAGMA index_list("${tableName}")`).all() as readonly { name: unknown }[]
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

function readSql(connection: MigrationConnection, type: 'table' | 'trigger', name: string): string {
  const row = connection
    .prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
    .get(type, name) as { sql?: unknown } | undefined
  return typeof row?.sql === 'string' ? row.sql : ''
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
