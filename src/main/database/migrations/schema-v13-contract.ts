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
import {
  hasSchemaVersion12OtherActivityDescriptionContract,
  schemaVersion12NamedIndexes,
  schemaVersion12TableContracts,
  schemaVersion12TableNames
} from './schema-v12-contract'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

export const foodCatalogSeedRows = Object.freeze([
  ['RICE', 'Rice', 'rice', 1],
  ['BEANS', 'Beans', 'beans', 2],
  ['CORN_FUFU', 'Corn fufu', 'corn fufu', 3],
  ['WATER_FUFU', 'Water fufu', 'water fufu', 4],
  ['GARRI', 'Garri', 'garri', 5],
  ['PLANTAIN', 'Plantain', 'plantain', 6],
  ['YAM', 'Yam', 'yam', 7],
  ['COCOYAM', 'Cocoyam', 'cocoyam', 8],
  ['IRISH_POTATO', 'Irish potato', 'irish potato', 9],
  ['SWEET_POTATO', 'Sweet potato', 'sweet potato', 10],
  ['CASSAVA', 'Cassava', 'cassava', 11],
  ['LEAFY_VEGETABLES', 'Leafy vegetables', 'leafy vegetables', 12],
  ['OTHER_VEGETABLES', 'Other vegetables', 'other vegetables', 13],
  ['FRUIT', 'Fruit', 'fruit', 14],
  ['FISH', 'Fish', 'fish', 15],
  ['CHICKEN', 'Chicken', 'chicken', 16],
  ['BEEF', 'Beef', 'beef', 17],
  ['PORK', 'Pork', 'pork', 18],
  ['EGGS', 'Eggs', 'eggs', 19],
  ['BREAD', 'Bread', 'bread', 20],
  ['GROUNDNUTS', 'Groundnuts', 'groundnuts', 21],
  ['MILK_DAIRY', 'Milk or dairy', 'milk or dairy', 22],
  ['FRIED_FOODS', 'Fried foods', 'fried foods', 23],
  ['PROCESSED_MEATS', 'Processed meats', 'processed meats', 24],
  ['INSTANT_NOODLES', 'Instant noodles', 'instant noodles', 25],
  ['SUGARY_DRINKS', 'Sugary drinks', 'sugary drinks', 26]
] as const)

const foodCatalogItemsTable = table('food_catalog_items', [
  textPk('code'),
  textRequired('display_name'),
  textRequired('normalized_search_name'),
  integerRequired('is_active'),
  integerRequired('sort_order'),
  textRequired('created_at'),
  textRequired('updated_at')
])

const foodDraftsTable = table('food_drafts', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('patient_id'),
  textRequired('screening_session_id'),
  textRequired('location_id'),
  textRequired('installation_id'),
  textRequired('period_start'),
  textRequired('period_end'),
  textOptional('food_response'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at'),
  integerRequired('row_version')
])

const foodDraftRowsTable = table('food_draft_rows', [
  textPk('id'),
  textRequired('food_draft_id'),
  integerRequired('sequence_number'),
  textOptional('catalog_code'),
  textRequired('food_name_snapshot'),
  textRequired('food_name_normalized'),
  textOptional('frequency_code'),
  textOptional('preparation_note'),
  textRequired('source_type'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const foodNamedIndexes = Object.freeze(
  [
    'ix_food_catalog_items_active_order',
    'ix_food_draft_rows_catalog',
    'ix_food_draft_rows_draft',
    'ix_food_drafts_encounter',
    'ix_food_drafts_patient'
  ].sort()
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

const foodForeignKeyContracts = Object.freeze(
  new Map<string, readonly ForeignKeyContract[]>([
    [
      'food_drafts',
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
      'food_draft_rows',
      Object.freeze([
        foreignKey('food_drafts', [['food_draft_id', 'id']]),
        foreignKey('food_catalog_items', [['catalog_code', 'code']]),
        foreignKey('users', [['created_by', 'id']]),
        foreignKey('users', [['updated_by', 'id']])
      ])
    ]
  ])
)

const requiredFoodTableSqlSnippets = Object.freeze(
  new Map<string, readonly string[]>([
    [
      'food_catalog_items',
      normalizedSqlSnippets([
        "display_name TEXT NOT NULL CHECK (TRIM(display_name) != '' AND length(display_name) <= 100)",
        "normalized_search_name TEXT NOT NULL COLLATE NOCASE CHECK (TRIM(normalized_search_name) != '' AND length(normalized_search_name) <= 100)",
        'is_active INTEGER NOT NULL CHECK (is_active IN (0, 1))',
        'sort_order INTEGER NOT NULL CHECK (sort_order > 0)',
        'CONSTRAINT ck_food_catalog_items_updated_at CHECK (updated_at >= created_at)',
        'CONSTRAINT ux_food_catalog_items_normalized_search_name UNIQUE (normalized_search_name)',
        'CONSTRAINT ux_food_catalog_items_sort_order UNIQUE (sort_order)'
      ])
    ],
    [
      'food_drafts',
      normalizedSqlSnippets([
        'encounter_id TEXT NOT NULL UNIQUE',
        "food_response TEXT NULL CHECK (food_response IN ('REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER'))",
        'row_version INTEGER NOT NULL CHECK (row_version >= 1)',
        'CONSTRAINT ck_food_drafts_period_dates CHECK (period_start <= period_end)',
        calendarDateConstraint('ck_food_drafts_period_start_date', 'period_start'),
        calendarDateConstraint('ck_food_drafts_period_end_date', 'period_end'),
        'CONSTRAINT ck_food_drafts_updated_at CHECK (updated_at >= created_at)'
      ])
    ],
    [
      'food_draft_rows',
      normalizedSqlSnippets([
        'sequence_number INTEGER NOT NULL CHECK (sequence_number > 0)',
        "food_name_snapshot TEXT NOT NULL CHECK (TRIM(food_name_snapshot) != '' AND length(food_name_snapshot) <= 100)",
        "food_name_normalized TEXT NOT NULL COLLATE NOCASE CHECK (TRIM(food_name_normalized) != '' AND length(food_name_normalized) <= 100)",
        "frequency_code TEXT NULL CHECK (frequency_code IS NULL OR frequency_code IN ('1_DAY', '2_TO_3_DAYS', '4_TO_6_DAYS', 'EVERY_DAY'))",
        "preparation_note TEXT NULL CHECK (preparation_note IS NULL OR (TRIM(preparation_note) != '' AND length(preparation_note) <= 200))",
        "source_type TEXT NOT NULL CHECK (source_type = 'PATIENT_REPORTED')",
        'CONSTRAINT ck_food_draft_rows_updated_at CHECK (updated_at >= created_at)',
        'CONSTRAINT ux_food_draft_rows_sequence UNIQUE (food_draft_id, sequence_number)',
        'CONSTRAINT ux_food_draft_rows_normalized_name UNIQUE (food_draft_id, food_name_normalized)'
      ])
    ]
  ])
)

export const schemaVersion13TableContracts = Object.freeze(
  [
    ...schemaVersion12TableContracts,
    foodCatalogItemsTable,
    foodDraftsTable,
    foodDraftRowsTable
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion13TableNames = Object.freeze(
  [...schemaVersion12TableNames, 'food_catalog_items', 'food_draft_rows', 'food_drafts'].sort()
)
export const schemaVersion13NamedIndexes = Object.freeze(
  [...schemaVersion12NamedIndexes, ...foodNamedIndexes].sort()
)
export const schemaVersion13TriggerNames = schemaVersion11TriggerNames

export function validateSchemaVersion13(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion13Valid(connection)) {
    if (mode === 'execution') throw new MigrationExecutionError()
    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion13Valid(connection: MigrationConnection): boolean {
  try {
    return (
      arraysEqual(readTableNames(connection), schemaVersion13TableNames) &&
      hasStrictTables(connection) &&
      arraysEqual(readIndexNames(connection), schemaVersion13NamedIndexes) &&
      arraysEqual(readTriggerNames(connection), schemaVersion13TriggerNames) &&
      schemaVersion13TableContracts.every((tableContract) =>
        columnsMatch(readColumns(connection, tableContract.name), tableContract.columns)
      ) &&
      hasSchemaVersion9RequiredForeignKeys(connection) &&
      hasSchemaVersion9RequiredTableSql(connection) &&
      hasSchemaVersion10RequiredResponseChecks(connection) &&
      hasSchemaVersion11ExactTriggerSql(connection) &&
      hasSchemaVersion12OtherActivityDescriptionContract(connection) &&
      hasSchemaVersion13FoodTableSql(connection) &&
      hasSchemaVersion13FoodForeignKeys(connection) &&
      hasSchemaVersion13FoodCatalogSeed(connection)
    )
  } catch {
    return false
  }
}

export function hasSchemaVersion13FoodTableSql(connection: MigrationConnection): boolean {
  return [...requiredFoodTableSqlSnippets.entries()].every(([tableName, requiredSnippets]) => {
    const tableSql = normalizeSchemaSql(readCreateTableSql(connection, tableName))
    return requiredSnippets.every((snippet) => tableSql.includes(snippet))
  })
}

export function hasSchemaVersion13FoodForeignKeys(connection: MigrationConnection): boolean {
  return [...foodForeignKeyContracts.entries()].every(([tableName, expected]) =>
    foreignKeyContractsMatch(readForeignKeys(connection, tableName), expected)
  )
}

export function hasSchemaVersion13FoodCatalogSeed(connection: MigrationConnection): boolean {
  const rows = connection
    .prepare(
      'SELECT code, display_name, normalized_search_name, is_active, sort_order FROM food_catalog_items ORDER BY sort_order, code'
    )
    .all() as readonly {
    code: unknown
    display_name: unknown
    normalized_search_name: unknown
    is_active: unknown
    sort_order: unknown
  }[]

  return (
    rows.length === foodCatalogSeedRows.length &&
    rows.every((row, index) => {
      const expected = foodCatalogSeedRows[index]
      return (
        expected !== undefined &&
        row.code === expected[0] &&
        row.display_name === expected[1] &&
        row.normalized_search_name === expected[2] &&
        Number(row.is_active) === 1 &&
        Number(row.sort_order) === expected[3]
      )
    })
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

  return schemaVersion13TableNames.every((name) => strictTables.get(name) === 1)
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

function normalizedSqlSnippets(snippets: readonly string[]): readonly string[] {
  return Object.freeze(snippets.map(normalizeSchemaSql))
}

function calendarDateConstraint(constraintName: string, columnName: string): string {
  return `CONSTRAINT ${constraintName} CHECK (
    length(${columnName}) = 10
    AND ${columnName} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
    AND CAST(substr(${columnName}, 6, 2) AS INTEGER) BETWEEN 1 AND 12
    AND CAST(substr(${columnName}, 9, 2) AS INTEGER) BETWEEN 1 AND
      CASE
        WHEN CAST(substr(${columnName}, 6, 2) AS INTEGER) IN (1, 3, 5, 7, 8, 10, 12) THEN 31
        WHEN CAST(substr(${columnName}, 6, 2) AS INTEGER) IN (4, 6, 9, 11) THEN 30
        WHEN (
          CAST(substr(${columnName}, 1, 4) AS INTEGER) % 400 = 0
          OR (
            CAST(substr(${columnName}, 1, 4) AS INTEGER) % 4 = 0
            AND CAST(substr(${columnName}, 1, 4) AS INTEGER) % 100 != 0
          )
        ) THEN 29
        ELSE 28
      END
  )`
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
