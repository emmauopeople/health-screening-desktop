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
  hasSchemaVersion9RequiredForeignKeys,
  hasSchemaVersion9RequiredTableSql
} from './schema-v9-contract'
import { hasSchemaVersion10RequiredResponseChecks } from './schema-v10-contract'
import { hasSchemaVersion11ExactTriggerSql } from './schema-v11-contract'
import { hasSchemaVersion12OtherActivityDescriptionContract } from './schema-v12-contract'
import {
  hasSchemaVersion13FoodCatalogSeed,
  hasSchemaVersion13FoodForeignKeys,
  hasSchemaVersion13FoodTableSql
} from './schema-v13-contract'
import {
  hasSchemaVersion14OtcForeignKeys,
  hasSchemaVersion14OtcTableSql,
  schemaVersion14NamedIndexes,
  schemaVersion14TableContracts,
  schemaVersion14TableNames,
  schemaVersion14TriggerNames
} from './schema-v14-contract'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

const addendaTable = table('screening_encounter_addenda', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('note_text'),
  textRequired('created_by'),
  textRequired('created_at')
])

const flagsTable = table('screening_encounter_review_flags', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('category'),
  textRequired('description'),
  textRequired('status'),
  textRequired('opened_by'),
  textRequired('opened_at'),
  textOptional('resolved_by'),
  textOptional('resolved_at'),
  textOptional('resolution_note')
])

export const schemaVersion15TableContracts = Object.freeze(
  [...schemaVersion14TableContracts, addendaTable, flagsTable].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
)
export const schemaVersion15TableNames = Object.freeze(
  [
    ...schemaVersion14TableNames,
    'screening_encounter_addenda',
    'screening_encounter_review_flags'
  ].sort()
)
export const schemaVersion15NamedIndexes = Object.freeze(
  [
    ...schemaVersion14NamedIndexes,
    'ix_screening_encounter_addenda_encounter',
    'ix_screening_encounter_review_flags_encounter',
    'ix_screening_encounter_review_flags_status'
  ].sort()
)
export const schemaVersion15TriggerNames = schemaVersion14TriggerNames

const canonicalManagementSql = Object.freeze(
  new Map([
    [
      'screening_encounter_addenda',
      normalizeSchemaSql(`
        CREATE TABLE screening_encounter_addenda (
          id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL,
          note_text TEXT NOT NULL CHECK (TRIM(note_text) != '' AND length(note_text) <= 2000),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CONSTRAINT fk_screening_encounter_addenda_encounter FOREIGN KEY (encounter_id)
            REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_screening_encounter_addenda_created_by FOREIGN KEY (created_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
      `)
    ],
    [
      'screening_encounter_review_flags',
      normalizeSchemaSql(`
        CREATE TABLE screening_encounter_review_flags (
          id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL,
          category TEXT NOT NULL CHECK (
            category IN ('POSSIBLE_DATA_ERROR', 'MISSING_INFORMATION', 'WRONG_PATIENT', 'DUPLICATE_ENCOUNTER', 'OTHER')
          ),
          description TEXT NOT NULL CHECK (TRIM(description) != '' AND length(description) <= 1000),
          status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
          opened_by TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          resolved_by TEXT NULL,
          resolved_at TEXT NULL,
          resolution_note TEXT NULL CHECK (
            resolution_note IS NULL OR (TRIM(resolution_note) != '' AND length(resolution_note) <= 1000)
          ),
          CONSTRAINT ck_screening_encounter_review_flags_resolution CHECK (
            (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL AND resolution_note IS NULL)
            OR (status IN ('RESOLVED', 'DISMISSED') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
              AND resolution_note IS NOT NULL AND resolved_at >= opened_at)
          ),
          CONSTRAINT fk_screening_encounter_review_flags_encounter FOREIGN KEY (encounter_id)
            REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_screening_encounter_review_flags_opened_by FOREIGN KEY (opened_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_screening_encounter_review_flags_resolved_by FOREIGN KEY (resolved_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
      `)
    ]
  ])
)

export function validateSchemaVersion15(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion15Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion15Valid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readNames(connection, 'table'), schemaVersion15TableNames) &&
      arraysEqual(readNames(connection, 'index'), schemaVersion15NamedIndexes) &&
      arraysEqual(readNames(connection, 'trigger'), schemaVersion15TriggerNames) &&
      hasStrictTables(connection) &&
      schemaVersion15TableContracts.every((contract) =>
        columnsMatch(readColumns(connection, contract.name), contract.columns)
      ) &&
      hasSchemaVersion9RequiredForeignKeys(connection) &&
      hasSchemaVersion9RequiredTableSql(connection) &&
      hasSchemaVersion10RequiredResponseChecks(connection) &&
      hasSchemaVersion11ExactTriggerSql(connection) &&
      hasSchemaVersion12OtherActivityDescriptionContract(connection) &&
      hasSchemaVersion13FoodTableSql(connection) &&
      hasSchemaVersion13FoodForeignKeys(connection) &&
      hasSchemaVersion13FoodCatalogSeed(connection) &&
      hasSchemaVersion14OtcTableSql(connection) &&
      hasSchemaVersion14OtcForeignKeys(connection) &&
      hasExactManagementSql(connection) &&
      hasExactManagementForeignKeys(connection)
    )
  } catch {
    return false
  }
}

function hasExactManagementSql(connection: MigrationConnection): boolean {
  return [...canonicalManagementSql.entries()].every(([name, expected]) => {
    const row = connection
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { sql?: unknown } | undefined
    return normalizeSchemaSql(typeof row?.sql === 'string' ? row.sql : '') === expected
  })
}

function hasExactManagementForeignKeys(connection: MigrationConnection): boolean {
  const expected = new Map<string, readonly string[]>([
    [
      'screening_encounter_addenda',
      [
        'screening_encounters:encounter_id:id:RESTRICT:RESTRICT',
        'users:created_by:id:RESTRICT:RESTRICT'
      ]
    ],
    [
      'screening_encounter_review_flags',
      [
        'screening_encounters:encounter_id:id:RESTRICT:RESTRICT',
        'users:opened_by:id:RESTRICT:RESTRICT',
        'users:resolved_by:id:RESTRICT:RESTRICT'
      ]
    ]
  ])
  return [...expected.entries()].every(([tableName, entries]) => {
    const actual = (
      connection.prepare(`PRAGMA foreign_key_list("${tableName}")`).all() as readonly {
        table: unknown
        from: unknown
        to: unknown
        on_update: unknown
        on_delete: unknown
      }[]
    )
      .map(
        (row) =>
          `${String(row.table)}:${String(row.from)}:${String(row.to)}:${String(row.on_update)}:${String(row.on_delete)}`
      )
      .sort()
    return arraysEqual(actual, [...entries].sort())
  })
}

function hasStrictTables(connection: MigrationConnection): boolean {
  const strict = new Map(
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
  return schemaVersion15TableNames.every((name) => strict.get(name) === 1)
}

function readNames(
  connection: MigrationConnection,
  type: 'table' | 'index' | 'trigger'
): readonly string[] {
  const sqliteFilter = type === 'trigger' ? '' : " AND name NOT LIKE 'sqlite_%'"
  return (
    connection
      .prepare(`SELECT name FROM sqlite_master WHERE type = ?${sqliteFilter} ORDER BY name`)
      .all(type) as readonly { name: unknown }[]
  ).map((row) => String(row.name))
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
    type: String(row.type) as SqliteStorageType,
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({ name, columns: Object.freeze([...columns]) })
}
function column(
  name: string,
  type: SqliteStorageType,
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
function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
