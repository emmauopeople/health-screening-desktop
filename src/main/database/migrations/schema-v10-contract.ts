import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'
import {
  schemaVersion9NamedIndexes,
  schemaVersion9TableContracts,
  schemaVersion9TableNames,
  schemaVersion9TriggerNames
} from './schema-v9-contract'

export const schemaVersion10TableContracts = Object.freeze(
  schemaVersion9TableContracts
    .map((tableContract) => {
      if (tableContract.name === 'lifestyle_drafts')
        return {
          ...tableContract,
          columns: Object.freeze([
            ...tableContract.columns,
            {
              name: 'other_activity_response',
              type: 'TEXT',
              notNull: 0,
              primaryKey: 0,
              defaultValue: null,
              hidden: 0
            }
          ])
        }
      if (tableContract.name === 'lifestyle_physical_activity_weekly_records')
        return {
          ...tableContract,
          columns: Object.freeze([
            ...tableContract.columns,
            {
              name: 'sedentary_time_response',
              type: 'TEXT',
              notNull: 0,
              primaryKey: 0,
              defaultValue: null,
              hidden: 0
            }
          ])
        }
      return tableContract
    })
    .sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion10TableNames = schemaVersion9TableNames
export const schemaVersion10TriggerNames = schemaVersion9TriggerNames
export const schemaVersion10NamedIndexes = schemaVersion9NamedIndexes

export function validateSchemaVersion10(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion10Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion10Valid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readTableNames(connection), schemaVersion10TableNames) &&
      hasStrictTables(connection) &&
      arraysEqual(readIndexNames(connection), schemaVersion10NamedIndexes) &&
      arraysEqual(readTriggerNames(connection), schemaVersion10TriggerNames) &&
      schemaVersion10TableContracts.every((tableContract) =>
        columnsMatch(readColumns(connection, tableContract.name), tableContract.columns)
      ) &&
      hasResponseChecks(connection)
    )
  } catch {
    return false
  }
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
  return schemaVersion10TableNames.every((name) => strictTables.get(name) === 1)
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
      .all() as readonly {
      name: unknown
    }[]
  ).map((row) => String(row.name))
}

function readColumns(
  connection: MigrationConnection,
  tableName: string
): readonly {
  name: string
  type: string
  notNull: 0 | 1
  primaryKey: number
  defaultValue: string | null
  hidden: number
}[] {
  return (
    connection.prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`).all() as readonly {
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

function hasResponseChecks(connection: MigrationConnection): boolean {
  const draftSql = readCreateTableSql(connection, 'lifestyle_drafts')
  const physicalSql = readCreateTableSql(connection, 'lifestyle_physical_activity_weekly_records')
  return (
    draftSql.includes('other_activity_response') &&
    draftSql.includes("'PREFER_NOT_TO_ANSWER'") &&
    physicalSql.includes('sedentary_time_response') &&
    physicalSql.includes("'RECORDED'") &&
    physicalSql.includes("'UNABLE_TO_ANSWER'")
  )
}

function readCreateTableSql(connection: MigrationConnection, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined
  return typeof row?.sql === 'string' ? row.sql : ''
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
