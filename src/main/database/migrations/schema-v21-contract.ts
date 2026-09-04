import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  schemaVersion20NamedIndexes,
  schemaVersion20TableNames,
  schemaVersion20TriggerNames
} from './schema-v20-contract'

const addedTables = Object.freeze([
  'sync_identity_resolution_deliveries',
  'sync_patient_identity_links'
])

export const schemaVersion21TableNames = Object.freeze(
  [...schemaVersion20TableNames, ...addedTables].sort()
)
export const schemaVersion21NamedIndexes = Object.freeze(
  [...schemaVersion20NamedIndexes, 'ix_sync_identity_resolution_deliveries_pending'].sort()
)
export const schemaVersion21TriggerNames = Object.freeze(
  [
    ...schemaVersion20TriggerNames,
    'tr_sync_identity_resolution_acknowledgment_immutable',
    'tr_sync_identity_resolution_delivery_immutable'
  ].sort()
)

export function validateSchemaVersion21(
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
      arraysEqual(readNames(connection, 'table'), schemaVersion21TableNames) &&
      arraysEqual(readNames(connection, 'index'), schemaVersion21NamedIndexes) &&
      arraysEqual(readNames(connection, 'trigger'), schemaVersion21TriggerNames) &&
      schemaVersion21TableNames.every((name) => strictTables(connection).get(name) === 1) &&
      hasRequiredForeignKeys(connection) &&
      hasRequiredSql(connection)
    )
  } catch {
    return false
  }
}

function hasRequiredForeignKeys(connection: MigrationConnection): boolean {
  const encoded = JSON.stringify({
    links: connection.prepare('PRAGMA foreign_key_list("sync_patient_identity_links")').all(),
    deliveries: connection
      .prepare('PRAGMA foreign_key_list("sync_identity_resolution_deliveries")')
      .all()
  })
  return encoded.includes('patients')
}

function hasRequiredSql(connection: MigrationConnection): boolean {
  const linksSql = readSql(connection, 'table', 'sync_patient_identity_links')
  const deliveriesSql = readSql(connection, 'table', 'sync_identity_resolution_deliveries')
  const deliveryTrigger = readSql(
    connection,
    'trigger',
    'tr_sync_identity_resolution_delivery_immutable'
  )
  const acknowledgmentTrigger = readSql(
    connection,
    'trigger',
    'tr_sync_identity_resolution_acknowledgment_immutable'
  )
  return (
    linksSql.includes('CHS-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]') &&
    deliveriesSql.includes('json_valid(acknowledgment_json) = 1') &&
    deliveriesSql.includes('julianday(acknowledged_at) >= julianday(applied_at)') &&
    deliveryTrigger.includes('sync identity resolution delivery is immutable') &&
    acknowledgmentTrigger.includes('sync identity resolution acknowledgment is immutable')
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
