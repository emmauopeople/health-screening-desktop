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
import {
  schemaVersion10NamedIndexes,
  hasSchemaVersion10RequiredResponseChecks,
  schemaVersion10TableContracts,
  schemaVersion10TableNames,
  schemaVersion10TriggerNames
} from './schema-v10-contract'

const requiredTriggerSqlSnippets = Object.freeze(
  [
    "CREATE TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert BEFORE INSERT ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.systolic IS NOT NULL AND ( typeof(NEW.systolic) <> 'integer' OR NEW.systolic < 1 OR NEW.systolic > 300 ) BEGIN SELECT RAISE(ABORT, 'systolic out of range'); END",
    "CREATE TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_update BEFORE UPDATE OF systolic ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.systolic IS NOT NULL AND ( typeof(NEW.systolic) <> 'integer' OR NEW.systolic < 1 OR NEW.systolic > 300 ) BEGIN SELECT RAISE(ABORT, 'systolic out of range'); END",
    "CREATE TRIGGER ck_screening_vitals_draft_readings_diastolic_bounds_insert BEFORE INSERT ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.diastolic IS NOT NULL AND ( typeof(NEW.diastolic) <> 'integer' OR NEW.diastolic < 1 OR NEW.diastolic > 120 ) BEGIN SELECT RAISE(ABORT, 'diastolic out of range'); END",
    "CREATE TRIGGER ck_screening_vitals_draft_readings_diastolic_bounds_update BEFORE UPDATE OF diastolic ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.diastolic IS NOT NULL AND ( typeof(NEW.diastolic) <> 'integer' OR NEW.diastolic < 1 OR NEW.diastolic > 120 ) BEGIN SELECT RAISE(ABORT, 'diastolic out of range'); END",
    "CREATE TRIGGER ck_screening_vitals_draft_readings_pulse_bounds_insert BEFORE INSERT ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.pulse IS NOT NULL AND ( typeof(NEW.pulse) <> 'integer' OR NEW.pulse < 1 OR NEW.pulse > 300 ) BEGIN SELECT RAISE(ABORT, 'pulse out of range'); END",
    "CREATE TRIGGER ck_screening_vitals_draft_readings_pulse_bounds_update BEFORE UPDATE OF pulse ON screening_vitals_draft_readings FOR EACH ROW WHEN NEW.pulse IS NOT NULL AND ( typeof(NEW.pulse) <> 'integer' OR NEW.pulse < 1 OR NEW.pulse > 300 ) BEGIN SELECT RAISE(ABORT, 'pulse out of range'); END"
  ].map(normalizeSchemaSql)
)

const newTriggerNames = Object.freeze(
  requiredTriggerSqlSnippets
    .map((snippet) => snippet.match(/^CREATE TRIGGER (\S+)/u)?.[1] ?? '')
    .sort()
)

export const schemaVersion11TableContracts = schemaVersion10TableContracts
export const schemaVersion11TableNames = schemaVersion10TableNames
export const schemaVersion11NamedIndexes = schemaVersion10NamedIndexes
export const schemaVersion11TriggerNames = Object.freeze(
  [...schemaVersion10TriggerNames, ...newTriggerNames].sort()
)

export function validateSchemaVersion11(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion11Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion11Valid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readTableNames(connection), schemaVersion11TableNames) &&
      hasStrictTables(connection) &&
      arraysEqual(readIndexNames(connection), schemaVersion11NamedIndexes) &&
      arraysEqual(readTriggerNames(connection), schemaVersion11TriggerNames) &&
      schemaVersion11TableContracts.every((tableContract) =>
        columnsMatch(readColumns(connection, tableContract.name), tableContract.columns)
      ) &&
      hasSchemaVersion9RequiredForeignKeys(connection) &&
      hasSchemaVersion9RequiredTableSql(connection) &&
      hasSchemaVersion10RequiredResponseChecks(connection) &&
      hasExactTriggerSql(connection)
    )
  } catch {
    return false
  }
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

  return schemaVersion11TableNames.every((name) => strictTables.get(name) === 1)
}

function hasExactTriggerSql(connection: MigrationConnection): boolean {
  return newTriggerNames.every((triggerName) => {
    const row = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get(triggerName) as { sql?: unknown } | undefined
    const expected = requiredTriggerSqlSnippets.find((snippet) =>
      snippet.startsWith(`CREATE TRIGGER ${triggerName} `)
    )
    return (
      expected !== undefined &&
      typeof row?.sql === 'string' &&
      normalizeSchemaSql(row.sql) === expected
    )
  })
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

function normalizeSchemaSql(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/;\s*$/, '')
    .trim()
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
