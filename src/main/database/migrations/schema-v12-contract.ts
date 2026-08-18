import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  hasSchemaVersion9RequiredForeignKeys,
  hasSchemaVersion9RequiredTableSql
} from './schema-v9-contract'
import { hasSchemaVersion10RequiredResponseChecks } from './schema-v10-contract'
import {
  hasSchemaVersion11ExactTriggerSql,
  schemaVersion11NamedIndexes,
  schemaVersion11TableContracts,
  schemaVersion11TableNames,
  schemaVersion11TriggerNames
} from './schema-v11-contract'

const requiredOtherActivityRowSqlSnippets = Object.freeze(
  [
    'description TEXT NULL',
    "CONSTRAINT ck_lifestyle_other_activity_rows_description_nonblank CHECK (description IS NULL OR TRIM(description) != '')",
    "category TEXT NOT NULL CHECK ( category IN ('FARMING_GARDENING', 'HOUSEHOLD', 'CAREGIVING', 'COMMUNITY', 'COMMUTE', 'SPORT', 'OTHER') )",
    'days_in_past_seven_days INTEGER NOT NULL CHECK (days_in_past_seven_days BETWEEN 1 AND 7)',
    'average_minutes_per_day INTEGER NOT NULL CHECK (average_minutes_per_day > 0)',
    "intensity TEXT NOT NULL CHECK (intensity IN ('LIGHT', 'MODERATE', 'VIGOROUS'))",
    'CONSTRAINT ck_lifestyle_other_activity_rows_updated_at CHECK (updated_at >= created_at)',
    'CONSTRAINT fk_lifestyle_other_activity_rows_parent FOREIGN KEY (lifestyle_draft_id) REFERENCES lifestyle_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    'CONSTRAINT fk_lifestyle_other_activity_rows_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    'CONSTRAINT fk_lifestyle_other_activity_rows_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    'CONSTRAINT ux_lifestyle_other_activity_rows_sequence UNIQUE (lifestyle_draft_id, sequence_number)'
  ].map(normalizeSchemaSql)
)

export const schemaVersion12TableContracts = Object.freeze(
  schemaVersion11TableContracts.map((tableContract) =>
    tableContract.name === 'lifestyle_other_activity_rows'
      ? {
          ...tableContract,
          columns: Object.freeze(
            tableContract.columns.map((column) =>
              column.name === 'description' ? { ...column, notNull: 0 } : column
            )
          )
        }
      : tableContract
  )
)
export const schemaVersion12TableNames = schemaVersion11TableNames
export const schemaVersion12NamedIndexes = schemaVersion11NamedIndexes
export const schemaVersion12TriggerNames = schemaVersion11TriggerNames

export function validateSchemaVersion12(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion12Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion12Valid(connection: MigrationConnection): boolean {
  try {
    const checks = [
      arraysEqual(readTableNames(connection), schemaVersion12TableNames),
      hasStrictTables(connection),
      arraysEqual(readIndexNames(connection), schemaVersion12NamedIndexes),
      arraysEqual(readTriggerNames(connection), schemaVersion12TriggerNames),
      schemaVersion12TableContracts.every((tableContract) =>
        columnsMatch(readColumns(connection, tableContract.name), tableContract.columns)
      ),
      hasSchemaVersion9RequiredForeignKeys(connection),
      hasSchemaVersion9RequiredTableSql(connection),
      hasSchemaVersion10RequiredResponseChecks(connection),
      hasSchemaVersion11ExactTriggerSql(connection),
      hasSchemaVersion12OtherActivityDescriptionContract(connection)
    ]
    return checks.every(Boolean)
  } catch {
    return false
  }
}

function hasSchemaVersion12OtherActivityDescriptionContract(
  connection: MigrationConnection
): boolean {
  const tableSql = normalizeSchemaSql(
    readCreateTableSql(connection, 'lifestyle_other_activity_rows')
  )

  return requiredOtherActivityRowSqlSnippets.every((snippet) => tableSql.includes(snippet))
}

function hasStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
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
  return schemaVersion12TableNames.every((name) => strictTables.get(name) === 1)
}

function readTableNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as readonly { name: unknown }[]
  ).map((row) => String(row.name))
}

function readIndexNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name`
      )
      .all() as readonly { name: unknown }[]
  ).map((row) => String(row.name))
}

function readTriggerNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as readonly { name: unknown }[]
  ).map((row) => String(row.name))
}

function readColumns(connection: MigrationConnection, tableName: string): readonly unknown[] {
  return (
    connection
      .prepare(`PRAGMA table_xinfo("${tableName.replaceAll('"', '""')}")`)
      .all() as readonly {
      name: unknown
      type: unknown
      notnull: unknown
      dflt_value: unknown
      pk: unknown
      hidden: unknown
    }[]
  ).map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function columnsMatch(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function readCreateTableSql(connection: MigrationConnection, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined
  return typeof row?.sql === 'string' ? row.sql : ''
}

function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*$/, '')
    .trim()
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
