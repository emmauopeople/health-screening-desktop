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
  schemaVersion17NamedIndexes,
  schemaVersion17TableContracts,
  schemaVersion17TableNames,
  schemaVersion17TriggerNames
} from './schema-v17-contract'

const actionsTable = table('referral_followup_actions', [
  textPk('id'),
  textRequired('followup_id'),
  textRequired('action_code'),
  integerRequired('sequence_number')
])
const medicationsTable = table('referral_followup_medication_changes', [
  textPk('id'),
  textRequired('followup_id'),
  textRequired('change_type'),
  textRequired('medication_name'),
  textOptional('dosage'),
  textOptional('frequency'),
  integerRequired('sequence_number')
])

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
  primaryKey: number
): SchemaVersion1ColumnContract {
  return Object.freeze({ name, type, notNull, primaryKey, defaultValue: null, hidden: 0 })
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

export const schemaVersion18TableContracts = Object.freeze(
  [
    ...(schemaVersion17TableContracts as readonly SchemaVersion1TableContract[]),
    actionsTable,
    medicationsTable
  ].sort((left, right) => left.name.localeCompare(right.name))
)
export const schemaVersion18TableNames = Object.freeze(
  [
    ...schemaVersion17TableNames,
    'referral_followup_actions',
    'referral_followup_medication_changes'
  ].sort()
)
export const schemaVersion18NamedIndexes = Object.freeze(
  [
    ...schemaVersion17NamedIndexes,
    'ix_referral_followup_actions_followup',
    'ix_referral_followup_medication_changes_followup'
  ].sort()
)
export const schemaVersion18TriggerNames = schemaVersion17TriggerNames

export function validateSchemaVersion18(
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
      arraysEqual(readNames(connection, 'table'), schemaVersion18TableNames) &&
      arraysEqual(readNames(connection, 'index'), schemaVersion18NamedIndexes) &&
      arraysEqual(readNames(connection, 'trigger'), schemaVersion18TriggerNames) &&
      schemaVersion18TableNames.every((name) => strictTables(connection).get(name) === 1) &&
      schemaVersion18TableContracts.every((contract) =>
        columnsEqual(readColumns(connection, contract.name), contract.columns)
      ) &&
      hasForeignKeys(connection) &&
      hasRequiredSql(connection)
    )
  } catch {
    return false
  }
}

function hasForeignKeys(connection: MigrationConnection): boolean {
  for (const tableName of ['referral_followup_actions', 'referral_followup_medication_changes']) {
    const rows = connection.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as readonly {
      table: unknown
      from: unknown
      to: unknown
      on_update: unknown
      on_delete: unknown
    }[]
    if (
      !rows.some(
        (row) =>
          row.table === 'followups' &&
          row.from === 'followup_id' &&
          row.to === 'id' &&
          row.on_update === 'RESTRICT' &&
          row.on_delete === 'CASCADE'
      )
    )
      return false
  }
  return true
}

function hasRequiredSql(connection: MigrationConnection): boolean {
  const sql = ['referral_followup_actions', 'referral_followup_medication_changes'].map((name) => {
    const row = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { sql?: unknown } | undefined
    return typeof row?.sql === 'string' ? row.sql : ''
  })
  return (
    sql[0]?.includes("'TREATMENT_INITIATED', 'TREATMENT_MODIFIED', 'NEW_MEDICATION'") === true &&
    sql[1]?.includes("'NEW_MEDICATION', 'TREATMENT_MODIFIED'") === true &&
    sql[1]?.includes('TRIM(medication_name)') === true &&
    sql.every((value) => value.endsWith('STRICT'))
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

function columnsEqual(
  actual: readonly SchemaVersion1ColumnContract[],
  expected: readonly SchemaVersion1ColumnContract[]
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}
function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
