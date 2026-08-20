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
import {
  hasSchemaVersion11ExactTriggerSql,
  schemaVersion11TriggerNames
} from './schema-v11-contract'
import { hasSchemaVersion12OtherActivityDescriptionContract } from './schema-v12-contract'
import {
  hasSchemaVersion13FoodCatalogSeed,
  hasSchemaVersion13FoodForeignKeys,
  hasSchemaVersion13FoodTableSql,
  schemaVersion13NamedIndexes,
  schemaVersion13TableContracts,
  schemaVersion13TableNames
} from './schema-v13-contract'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

const otcDraftsTable = table('otc_drafts', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('patient_id'),
  textRequired('screening_session_id'),
  textRequired('location_id'),
  textRequired('installation_id'),
  textRequired('period_start'),
  textRequired('period_end'),
  textOptional('otc_response'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at'),
  integerRequired('row_version')
])

const otcDraftRowsTable = table('otc_draft_rows', [
  textPk('id'),
  textRequired('otc_draft_id'),
  integerRequired('sequence_number'),
  textOptional('product_name_snapshot'),
  textOptional('product_name_normalized'),
  textOptional('reason_for_use'),
  textOptional('dose_text'),
  textOptional('frequency_text'),
  textOptional('duration_text'),
  textOptional('source_of_medication'),
  textOptional('currently_taking_response'),
  textRequired('source_type'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const otcNamedIndexes = Object.freeze(
  ['ix_otc_draft_rows_draft', 'ix_otc_drafts_encounter', 'ix_otc_drafts_patient'].sort()
)

interface ForeignKeyColumnContract {
  readonly from: string
  readonly to: string
}

interface ForeignKeyContract {
  readonly referencedTable: string
  readonly onUpdate: string
  readonly onDelete: string
  readonly columns: readonly ForeignKeyColumnContract[]
}

const otcForeignKeyContracts = Object.freeze(
  new Map<string, readonly ForeignKeyContract[]>([
    [
      'otc_drafts',
      Object.freeze([
        foreignKey('screening_encounters', [
          ['encounter_id', 'id'],
          ['patient_id', 'patient_id'],
          ['screening_session_id', 'screening_session_id'],
          ['location_id', 'location_id']
        ]),
        foreignKey('screening_encounters', [['encounter_id', 'id']]),
        foreignKey('patients', [['patient_id', 'id']]),
        foreignKey('screening_sessions', [['screening_session_id', 'id']]),
        foreignKey('locations', [['location_id', 'id']]),
        foreignKey('installation', [['installation_id', 'id']]),
        foreignKey('users', [['created_by', 'id']]),
        foreignKey('users', [['updated_by', 'id']])
      ])
    ],
    [
      'otc_draft_rows',
      Object.freeze([
        foreignKey('otc_drafts', [['otc_draft_id', 'id']]),
        foreignKey('users', [['created_by', 'id']]),
        foreignKey('users', [['updated_by', 'id']])
      ])
    ]
  ])
)

const canonicalOtcTableSql = Object.freeze(
  new Map([
    [
      'otc_drafts',
      normalizeSchemaSql(`
        CREATE TABLE otc_drafts (
          id TEXT PRIMARY KEY,
          encounter_id TEXT NOT NULL UNIQUE,
          patient_id TEXT NOT NULL,
          screening_session_id TEXT NOT NULL,
          location_id TEXT NOT NULL,
          installation_id TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          otc_response TEXT NULL CHECK (
            otc_response IN ('REPORTED', 'NONE_REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER')
          ),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          row_version INTEGER NOT NULL CHECK (row_version >= 1),
          CONSTRAINT ck_otc_drafts_period_dates CHECK (period_start <= period_end),
          CONSTRAINT ck_otc_drafts_period_start_date CHECK (
            length(period_start) = 10
            AND period_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
            AND CAST(substr(period_start, 6, 2) AS INTEGER) BETWEEN 1 AND 12
            AND CAST(substr(period_start, 9, 2) AS INTEGER) BETWEEN 1 AND
              CASE
                WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
                WHEN CAST(substr(period_start, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
                WHEN (
                  CAST(substr(period_start, 1, 4) AS INTEGER) % 400 = 0
                  OR (
                    CAST(substr(period_start, 1, 4) AS INTEGER) % 4 = 0
                    AND CAST(substr(period_start, 1, 4) AS INTEGER) % 100 != 0
                  )
                ) THEN 29
                ELSE 28
              END
          ),
          CONSTRAINT ck_otc_drafts_period_end_date CHECK (
            length(period_end) = 10
            AND period_end GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
            AND CAST(substr(period_end, 6, 2) AS INTEGER) BETWEEN 1 AND 12
            AND CAST(substr(period_end, 9, 2) AS INTEGER) BETWEEN 1 AND
              CASE
                WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
                WHEN CAST(substr(period_end, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
                WHEN (
                  CAST(substr(period_end, 1, 4) AS INTEGER) % 400 = 0
                  OR (
                    CAST(substr(period_end, 1, 4) AS INTEGER) % 4 = 0
                    AND CAST(substr(period_end, 1, 4) AS INTEGER) % 100 != 0
                  )
                ) THEN 29
                ELSE 28
              END
          ),
          CONSTRAINT ck_otc_drafts_updated_at CHECK (updated_at >= created_at),
          CONSTRAINT fk_otc_drafts_encounter_ownership
            FOREIGN KEY (encounter_id, patient_id, screening_session_id, location_id)
            REFERENCES screening_encounters (id, patient_id, screening_session_id, location_id)
            ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_encounter FOREIGN KEY (encounter_id)
            REFERENCES screening_encounters (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_patient FOREIGN KEY (patient_id)
            REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_screening_session FOREIGN KEY (screening_session_id)
            REFERENCES screening_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_location FOREIGN KEY (location_id)
            REFERENCES locations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_installation FOREIGN KEY (installation_id)
            REFERENCES installation (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_created_by FOREIGN KEY (created_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_drafts_updated_by FOREIGN KEY (updated_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
        ) STRICT;
      `)
    ],
    [
      'otc_draft_rows',
      normalizeSchemaSql(`
        CREATE TABLE otc_draft_rows (
          id TEXT PRIMARY KEY,
          otc_draft_id TEXT NOT NULL,
          sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
          product_name_snapshot TEXT NULL CHECK (
            product_name_snapshot IS NULL OR (
              TRIM(product_name_snapshot) != ''
              AND length(product_name_snapshot) <= 160
            )
          ),
          product_name_normalized TEXT NULL COLLATE NOCASE CHECK (
            product_name_normalized IS NULL OR (
              TRIM(product_name_normalized) != ''
              AND length(product_name_normalized) <= 160
            )
          ),
          reason_for_use TEXT NULL CHECK (
            reason_for_use IS NULL OR (
              TRIM(reason_for_use) != ''
              AND length(reason_for_use) <= 500
            )
          ),
          dose_text TEXT NULL CHECK (
            dose_text IS NULL OR (
              TRIM(dose_text) != ''
              AND length(dose_text) <= 160
            )
          ),
          frequency_text TEXT NULL CHECK (
            frequency_text IS NULL OR (
              TRIM(frequency_text) != ''
              AND length(frequency_text) <= 160
            )
          ),
          duration_text TEXT NULL CHECK (
            duration_text IS NULL OR (
              TRIM(duration_text) != ''
              AND length(duration_text) <= 160
            )
          ),
          source_of_medication TEXT NULL CHECK (
            source_of_medication IS NULL OR (
              TRIM(source_of_medication) != ''
              AND length(source_of_medication) <= 160
            )
          ),
          currently_taking_response TEXT NULL CHECK (
            currently_taking_response IS NULL OR currently_taking_response IN ('YES', 'NO', 'UNKNOWN')
          ),
          source_type TEXT NOT NULL CHECK (source_type = 'PATIENT_REPORTED'),
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CONSTRAINT ck_otc_draft_rows_has_meaningful_value CHECK (
            product_name_snapshot IS NOT NULL
            OR reason_for_use IS NOT NULL
            OR dose_text IS NOT NULL
            OR frequency_text IS NOT NULL
            OR duration_text IS NOT NULL
            OR source_of_medication IS NOT NULL
            OR currently_taking_response IS NOT NULL
          ),
          CONSTRAINT ck_otc_draft_rows_name_pair CHECK (
            (product_name_snapshot IS NULL AND product_name_normalized IS NULL)
            OR (product_name_snapshot IS NOT NULL AND product_name_normalized IS NOT NULL)
          ),
          CONSTRAINT ck_otc_draft_rows_updated_at CHECK (updated_at >= created_at),
          CONSTRAINT fk_otc_draft_rows_parent FOREIGN KEY (otc_draft_id)
            REFERENCES otc_drafts (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_draft_rows_created_by FOREIGN KEY (created_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT fk_otc_draft_rows_updated_by FOREIGN KEY (updated_by)
            REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
          CONSTRAINT ux_otc_draft_rows_sequence UNIQUE (otc_draft_id, sequence_number)
        ) STRICT;
      `)
    ]
  ])
)

export const schemaVersion14TableContracts = Object.freeze(
  [...schemaVersion13TableContracts, otcDraftRowsTable, otcDraftsTable].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
)

export const schemaVersion14TableNames = Object.freeze(
  [...schemaVersion13TableNames, 'otc_draft_rows', 'otc_drafts'].sort()
)
export const schemaVersion14NamedIndexes = Object.freeze(
  [...schemaVersion13NamedIndexes, ...otcNamedIndexes].sort()
)
export const schemaVersion14TriggerNames = schemaVersion11TriggerNames

export function validateSchemaVersion14(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion14Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion14Valid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readTableNames(connection), schemaVersion14TableNames) &&
      hasStrictTables(connection) &&
      arraysEqual(readIndexNames(connection), schemaVersion14NamedIndexes) &&
      arraysEqual(readTriggerNames(connection), schemaVersion14TriggerNames) &&
      schemaVersion14TableContracts.every((tableContract) =>
        columnsMatch(readColumns(connection, tableContract.name), tableContract.columns)
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
      hasSchemaVersion14OtcForeignKeys(connection)
    )
  } catch {
    return false
  }
}

export function hasSchemaVersion14OtcTableSql(connection: MigrationConnection): boolean {
  return [...canonicalOtcTableSql.entries()].every(
    ([tableName, expectedSql]) =>
      normalizeSchemaSql(readCreateTableSql(connection, tableName)) === expectedSql
  )
}

export function hasSchemaVersion14OtcForeignKeys(connection: MigrationConnection): boolean {
  return [...otcForeignKeyContracts.entries()].every(([tableName, expected]) =>
    foreignKeyContractsMatch(readForeignKeys(connection, tableName), expected)
  )
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

  return schemaVersion14TableNames.every((name) => strictTables.get(name) === 1)
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

function readColumns(
  connection: MigrationConnection,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
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
    type: String(row.type) as SqliteStorageType,
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function readCreateTableSql(connection: MigrationConnection, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined
  return typeof row?.sql === 'string' ? row.sql : ''
}

function readForeignKeys(
  connection: MigrationConnection,
  tableName: string
): readonly ForeignKeyContract[] {
  const rows = connection
    .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)
    .all() as readonly {
    id: unknown
    seq: unknown
    table: unknown
    from: unknown
    to: unknown
    on_update: unknown
    on_delete: unknown
  }[]

  const grouped = new Map<
    number,
    {
      readonly referencedTable: string
      readonly onUpdate: string
      readonly onDelete: string
      readonly columns: ForeignKeyColumnContract[]
    }
  >()

  for (const row of rows) {
    const id = Number(row.id)
    const group =
      grouped.get(id) ??
      (() => {
        const created = {
          referencedTable: String(row.table),
          onUpdate: String(row.on_update),
          onDelete: String(row.on_delete),
          columns: []
        }
        grouped.set(id, created)
        return created
      })()
    group.columns[Number(row.seq)] = {
      from: String(row.from),
      to: String(row.to)
    }
  }

  return Object.freeze(
    [...grouped.values()]
      .map((foreignKey) =>
        foreignKeyContract(
          foreignKey.referencedTable,
          foreignKey.onUpdate,
          foreignKey.onDelete,
          foreignKey.columns
        )
      )
      .sort(compareForeignKeys)
  )
}

function foreignKey(
  referencedTable: string,
  columns: readonly (readonly [string, string])[]
): ForeignKeyContract {
  return foreignKeyContract(
    referencedTable,
    'RESTRICT',
    'RESTRICT',
    columns.map(([from, to]) => ({ from, to }))
  )
}

function foreignKeyContract(
  referencedTable: string,
  onUpdate: string,
  onDelete: string,
  columns: readonly ForeignKeyColumnContract[]
): ForeignKeyContract {
  return Object.freeze({
    referencedTable,
    onUpdate,
    onDelete,
    columns: Object.freeze([...columns])
  })
}

function foreignKeyContractsMatch(
  actual: readonly ForeignKeyContract[],
  expected: readonly ForeignKeyContract[]
): boolean {
  return (
    JSON.stringify([...actual].sort(compareForeignKeys)) ===
    JSON.stringify([...expected].sort(compareForeignKeys))
  )
}

function compareForeignKeys(left: ForeignKeyContract, right: ForeignKeyContract): number {
  return serializeForeignKey(left).localeCompare(serializeForeignKey(right))
}

function serializeForeignKey(foreignKey: ForeignKeyContract): string {
  return JSON.stringify(foreignKey)
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
  return Object.freeze({
    name,
    type,
    notNull,
    primaryKey,
    defaultValue: null,
    hidden: 0
  })
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
