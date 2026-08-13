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
  schemaVersion8NamedIndexes,
  schemaVersion8TableContracts,
  schemaVersion8TableNames,
  schemaVersion8TriggerNames
} from './schema-v8-contract'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

interface SqliteColumnInfoRow {
  name: unknown
  type: unknown
  notnull: unknown
  dflt_value: unknown
  pk: unknown
  hidden: unknown
}

interface SqliteForeignKeyRow {
  table: unknown
  from: unknown
  to: unknown
  on_update: unknown
  on_delete: unknown
}

interface SqliteNameRow {
  name: unknown
}

interface ForeignKeyContract {
  readonly tableName: string
  readonly from: string
  readonly toTable: string
  readonly to: string
  readonly onUpdate: string
  readonly onDelete: string
}

const alcoholBaselineVersionsTable = table('lifestyle_alcohol_baseline_versions', [
  textPk('id'),
  textRequired('patient_id'),
  textRequired('installation_id'),
  integerRequired('version'),
  textRequired('status'),
  textRequired('ever_consumed'),
  textRequired('consumed_past_12_months'),
  textOptional('common_beverage_types_json'),
  textOptional('other_beverage_description'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const tobaccoBaselineVersionsTable = table('lifestyle_tobacco_baseline_versions', [
  textPk('id'),
  textRequired('patient_id'),
  textRequired('installation_id'),
  integerRequired('version'),
  textRequired('status'),
  textRequired('ever_regularly_used'),
  textOptional('former_use_approximate_stop_date'),
  textRequired('current_use_frequency'),
  textOptional('product_types_json'),
  textOptional('other_product_description'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const workBaselineVersionsTable = table('lifestyle_work_baseline_versions', [
  textPk('id'),
  textRequired('patient_id'),
  textRequired('installation_id'),
  integerRequired('version'),
  textRequired('status'),
  textOptional('occupation_job_title'),
  textOptional('usual_physical_demand'),
  integerOptional('typical_workdays_per_week'),
  realOptional('typical_hours_per_workday'),
  textOptional('shift_pattern'),
  textOptional('description'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const lifestyleDraftsTable = table('lifestyle_drafts', [
  textPk('id'),
  textRequired('encounter_id'),
  textRequired('status'),
  textRequired('patient_id'),
  textRequired('screening_session_id'),
  textRequired('location_id'),
  textRequired('installation_id'),
  textRequired('period_start'),
  textRequired('period_end'),
  textOptional('alcohol_baseline_version_id'),
  textOptional('tobacco_baseline_version_id'),
  textOptional('work_baseline_version_id'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at'),
  integerRequired('row_version')
])

const alcoholWeeklyRecordsTable = table('lifestyle_alcohol_weekly_records', [
  textPk('id'),
  textRequired('lifestyle_draft_id'),
  textOptional('weekly_response'),
  integerOptional('drinking_days'),
  realOptional('total_standardized_drinks'),
  realOptional('largest_one_day_amount'),
  integerOptional('days_at_largest_amount'),
  textOptional('common_beverage_types_json'),
  textOptional('other_beverage_description'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const tobaccoWeeklyRecordsTable = table('lifestyle_tobacco_weekly_records', [
  textPk('id'),
  textRequired('lifestyle_draft_id'),
  textOptional('weekly_response'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const tobaccoProductRowsTable = table('lifestyle_tobacco_product_rows', [
  textPk('id'),
  textRequired('tobacco_weekly_record_id'),
  integerRequired('sequence_number'),
  textRequired('product_type'),
  integerRequired('days_used'),
  realRequired('average_quantity_per_use_day'),
  textRequired('unit'),
  integerOptional('secondhand_smoke_exposure'),
  textOptional('other_product_description'),
  textOptional('other_unit_description'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const physicalActivityWeeklyRecordsTable = table('lifestyle_physical_activity_weekly_records', [
  textPk('id'),
  textRequired('lifestyle_draft_id'),
  textOptional('weekly_response'),
  integerOptional('sedentary_minutes_per_day'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const activityRowsTable = table('lifestyle_activity_rows', [
  textPk('id'),
  textRequired('physical_activity_weekly_record_id'),
  integerRequired('sequence_number'),
  textRequired('activity_domain'),
  textOptional('description'),
  textRequired('intensity'),
  integerRequired('days_in_past_seven_days'),
  integerRequired('average_minutes_per_active_day'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const workWeeklyRecordsTable = table('lifestyle_work_weekly_records', [
  textPk('id'),
  textRequired('lifestyle_draft_id'),
  textOptional('weekly_response'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const otherActivityRowsTable = table('lifestyle_other_activity_rows', [
  textPk('id'),
  textRequired('lifestyle_draft_id'),
  integerRequired('sequence_number'),
  textRequired('category'),
  textRequired('description'),
  integerRequired('days_in_past_seven_days'),
  integerRequired('average_minutes_per_day'),
  textRequired('intensity'),
  textRequired('created_by'),
  textRequired('created_at'),
  textRequired('updated_by'),
  textRequired('updated_at')
])

const requiredForeignKeys = Object.freeze([
  foreignKey('lifestyle_alcohol_baseline_versions', 'patient_id', 'patients', 'id'),
  foreignKey('lifestyle_alcohol_baseline_versions', 'installation_id', 'installation', 'id'),
  foreignKey('lifestyle_alcohol_baseline_versions', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_alcohol_baseline_versions', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_tobacco_baseline_versions', 'patient_id', 'patients', 'id'),
  foreignKey('lifestyle_tobacco_baseline_versions', 'installation_id', 'installation', 'id'),
  foreignKey('lifestyle_tobacco_baseline_versions', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_tobacco_baseline_versions', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_work_baseline_versions', 'patient_id', 'patients', 'id'),
  foreignKey('lifestyle_work_baseline_versions', 'installation_id', 'installation', 'id'),
  foreignKey('lifestyle_work_baseline_versions', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_work_baseline_versions', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_drafts', 'encounter_id', 'screening_encounters', 'id'),
  foreignKey('lifestyle_drafts', 'patient_id', 'patients', 'id'),
  foreignKey('lifestyle_drafts', 'screening_session_id', 'screening_sessions', 'id'),
  foreignKey('lifestyle_drafts', 'location_id', 'locations', 'id'),
  foreignKey('lifestyle_drafts', 'installation_id', 'installation', 'id'),
  foreignKey(
    'lifestyle_drafts',
    'alcohol_baseline_version_id',
    'lifestyle_alcohol_baseline_versions',
    'id'
  ),
  foreignKey(
    'lifestyle_drafts',
    'tobacco_baseline_version_id',
    'lifestyle_tobacco_baseline_versions',
    'id'
  ),
  foreignKey(
    'lifestyle_drafts',
    'work_baseline_version_id',
    'lifestyle_work_baseline_versions',
    'id'
  ),
  foreignKey('lifestyle_drafts', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_drafts', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_alcohol_weekly_records', 'lifestyle_draft_id', 'lifestyle_drafts', 'id'),
  foreignKey('lifestyle_alcohol_weekly_records', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_alcohol_weekly_records', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_tobacco_weekly_records', 'lifestyle_draft_id', 'lifestyle_drafts', 'id'),
  foreignKey('lifestyle_tobacco_weekly_records', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_tobacco_weekly_records', 'updated_by', 'users', 'id'),
  foreignKey(
    'lifestyle_tobacco_product_rows',
    'tobacco_weekly_record_id',
    'lifestyle_tobacco_weekly_records',
    'id'
  ),
  foreignKey('lifestyle_tobacco_product_rows', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_tobacco_product_rows', 'updated_by', 'users', 'id'),
  foreignKey(
    'lifestyle_physical_activity_weekly_records',
    'lifestyle_draft_id',
    'lifestyle_drafts',
    'id'
  ),
  foreignKey('lifestyle_physical_activity_weekly_records', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_physical_activity_weekly_records', 'updated_by', 'users', 'id'),
  foreignKey(
    'lifestyle_activity_rows',
    'physical_activity_weekly_record_id',
    'lifestyle_physical_activity_weekly_records',
    'id'
  ),
  foreignKey('lifestyle_activity_rows', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_activity_rows', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_work_weekly_records', 'lifestyle_draft_id', 'lifestyle_drafts', 'id'),
  foreignKey('lifestyle_work_weekly_records', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_work_weekly_records', 'updated_by', 'users', 'id'),
  foreignKey('lifestyle_other_activity_rows', 'lifestyle_draft_id', 'lifestyle_drafts', 'id'),
  foreignKey('lifestyle_other_activity_rows', 'created_by', 'users', 'id'),
  foreignKey('lifestyle_other_activity_rows', 'updated_by', 'users', 'id')
])

const requiredTableSqlSnippets = Object.freeze([
  'status TEXT NOT NULL CHECK (',
  'CONSTRAINT ck_lifestyle_drafts_period_dates CHECK (period_start <= period_end)',
  'CONSTRAINT ck_lifestyle_drafts_period_start_date CHECK (',
  'CONSTRAINT ck_lifestyle_drafts_period_end_date CHECK (',
  'CONSTRAINT ck_lifestyle_drafts_updated_at CHECK (updated_at >= created_at)',
  'weekly_response TEXT NULL CHECK (',
  'row_version INTEGER NOT NULL CHECK (row_version >= 1)',
  'CONSTRAINT fk_lifestyle_drafts_encounter_ownership FOREIGN KEY (encounter_id, patient_id, screening_session_id, location_id)',
  'REFERENCES screening_encounters (id, patient_id, screening_session_id, location_id)',
  'CONSTRAINT fk_lifestyle_drafts_alcohol_baseline FOREIGN KEY (alcohol_baseline_version_id, patient_id, installation_id)',
  'CONSTRAINT fk_lifestyle_drafts_tobacco_baseline FOREIGN KEY (tobacco_baseline_version_id, patient_id, installation_id)',
  'CONSTRAINT fk_lifestyle_drafts_work_baseline FOREIGN KEY (work_baseline_version_id, patient_id, installation_id)',
  'CONSTRAINT ck_lifestyle_alcohol_weekly_records_no_branch CHECK',
  'CONSTRAINT ck_lifestyle_alcohol_weekly_records_yes_branch CHECK',
  'CONSTRAINT ck_lifestyle_alcohol_weekly_records_unknown_branch CHECK',
  'CONSTRAINT ck_lifestyle_alcohol_weekly_records_other_beverage_absent CHECK',
  'CONSTRAINT ck_lifestyle_tobacco_product_rows_other_product_required',
  'CONSTRAINT ux_lifestyle_activity_rows_sequence UNIQUE (physical_activity_weekly_record_id, sequence_number)',
  'CONSTRAINT ux_lifestyle_other_activity_rows_sequence UNIQUE (lifestyle_draft_id, sequence_number)',
  'CONSTRAINT ux_lifestyle_tobacco_product_rows_sequence UNIQUE (tobacco_weekly_record_id, sequence_number)'
])

export const schemaVersion9TableContracts = Object.freeze(
  [
    ...schemaVersion8TableContracts,
    alcoholBaselineVersionsTable,
    tobaccoBaselineVersionsTable,
    workBaselineVersionsTable,
    lifestyleDraftsTable,
    alcoholWeeklyRecordsTable,
    tobaccoWeeklyRecordsTable,
    tobaccoProductRowsTable,
    physicalActivityWeeklyRecordsTable,
    activityRowsTable,
    workWeeklyRecordsTable,
    otherActivityRowsTable
  ].sort((left, right) => left.name.localeCompare(right.name))
)

export const schemaVersion9TableNames = Object.freeze(
  [
    ...schemaVersion8TableNames,
    'lifestyle_alcohol_baseline_versions',
    'lifestyle_tobacco_baseline_versions',
    'lifestyle_work_baseline_versions',
    'lifestyle_drafts',
    'lifestyle_alcohol_weekly_records',
    'lifestyle_tobacco_weekly_records',
    'lifestyle_tobacco_product_rows',
    'lifestyle_physical_activity_weekly_records',
    'lifestyle_activity_rows',
    'lifestyle_work_weekly_records',
    'lifestyle_other_activity_rows'
  ].sort()
)

export const schemaVersion9TriggerNames = schemaVersion8TriggerNames

export const schemaVersion9NamedIndexes = Object.freeze(
  [
    ...schemaVersion8NamedIndexes,
    'ux_screening_encounters_lifestyle_draft_ownership',
    'ix_lifestyle_alcohol_baseline_versions_patient_installation',
    'ux_lifestyle_alcohol_baseline_versions_reference',
    'ux_lifestyle_alcohol_baseline_versions_version',
    'ix_lifestyle_tobacco_baseline_versions_patient_installation',
    'ux_lifestyle_tobacco_baseline_versions_reference',
    'ux_lifestyle_tobacco_baseline_versions_version',
    'ix_lifestyle_work_baseline_versions_patient_installation',
    'ux_lifestyle_work_baseline_versions_reference',
    'ux_lifestyle_work_baseline_versions_version',
    'ix_lifestyle_drafts_encounter',
    'ix_lifestyle_drafts_patient',
    'ix_lifestyle_alcohol_weekly_records_draft',
    'ix_lifestyle_tobacco_weekly_records_draft',
    'ix_lifestyle_tobacco_product_rows_draft',
    'ix_lifestyle_physical_activity_weekly_records_draft',
    'ix_lifestyle_activity_rows_record',
    'ix_lifestyle_work_weekly_records_draft',
    'ix_lifestyle_other_activity_rows_draft'
  ].sort()
)

export function validateSchemaVersion9(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion9Valid(connection)) {
    if (mode === 'execution') {
      throw new MigrationExecutionError()
    }

    throw new MigrationCompatibilityError()
  }
}

function isSchemaVersion9Valid(connection: MigrationConnection): boolean {
  try {
    const checks = {
      tables: hasExactTableNames(connection),
      strict: hasExactStrictTables(connection),
      indexes: hasExactNamedIndexes(connection),
      triggers: hasExactTriggerNames(connection),
      columns: hasExactColumns(connection),
      foreignKeys: hasRequiredForeignKeys(connection),
      sql: hasRequiredTableSql(connection)
    }
    const result = Object.values(checks).every(Boolean)
    return result
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion9TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    (
      connection.prepare('PRAGMA table_list').all() as ReadonlyArray<{
        schema: unknown
        name: unknown
        type: unknown
        strict: unknown
      }>
    )
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [String(row.name), Number(row.strict)])
  )

  return schemaVersion9TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion9NamedIndexes)
}

function hasExactTriggerNames(connection: MigrationConnection): boolean {
  return arraysEqual(readTriggerNames(connection), schemaVersion9TriggerNames)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion9TableContracts.every((tableContract) =>
    columnsMatch(readTableColumns(connection, tableContract.name), tableContract.columns)
  )
}

function hasRequiredForeignKeys(connection: MigrationConnection): boolean {
  return requiredForeignKeys.every((expected) =>
    readForeignKeys(connection, expected.tableName).some(
      (actual) =>
        actual.from === expected.from &&
        actual.toTable === expected.toTable &&
        actual.to === expected.to &&
        actual.onUpdate === expected.onUpdate &&
        actual.onDelete === expected.onDelete
    )
  )
}

function hasRequiredTableSql(connection: MigrationConnection): boolean {
  const sql = [
    readCreateTableSql(connection, 'lifestyle_drafts'),
    readCreateTableSql(connection, 'lifestyle_alcohol_baseline_versions'),
    readCreateTableSql(connection, 'lifestyle_alcohol_weekly_records'),
    readCreateTableSql(connection, 'lifestyle_tobacco_product_rows'),
    readCreateTableSql(connection, 'lifestyle_activity_rows'),
    readCreateTableSql(connection, 'lifestyle_other_activity_rows')
  ]
    .map(normalizeSchemaSql)
    .join(' ')

  return requiredTableSqlSnippets.every((snippet) => {
    const found = sql.includes(normalizeSchemaSql(snippet))
    return found
  })
}

function readNonInternalTableNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readNamedIndexNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readTriggerNames(connection: MigrationConnection): readonly string[] {
  return (
    connection
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name`)
      .all() as SqliteNameRow[]
  ).map((row) => String(row.name))
}

function readTableColumns(
  connection: MigrationConnection,
  tableName: string
): readonly SchemaVersion1ColumnContract[] {
  return (
    connection
      .prepare(`PRAGMA table_xinfo(${quoteIdentifier(tableName)})`)
      .all() as SqliteColumnInfoRow[]
  ).map((row) => ({
    name: String(row.name),
    type: String(row.type) as SqliteStorageType,
    notNull: Number(row.notnull) as 0 | 1,
    primaryKey: Number(row.pk),
    defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
    hidden: Number(row.hidden)
  }))
}

function readForeignKeys(
  connection: MigrationConnection,
  tableName: string
): readonly ForeignKeyContract[] {
  return (
    connection
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`)
      .all() as SqliteForeignKeyRow[]
  ).map((row) => ({
    tableName,
    from: String(row.from),
    toTable: String(row.table),
    to: String(row.to),
    onUpdate: String(row.on_update),
    onDelete: String(row.on_delete)
  }))
}

function readCreateTableSql(connection: MigrationConnection, tableName: string): string {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql?: unknown } | undefined

  return typeof row?.sql === 'string' ? row.sql : ''
}

function columnsMatch(
  actualColumns: readonly SchemaVersion1ColumnContract[],
  expectedColumns: readonly SchemaVersion1ColumnContract[]
): boolean {
  if (actualColumns.length !== expectedColumns.length) {
    return false
  }

  return actualColumns.every((actualColumn, index) => {
    const expectedColumn = expectedColumns[index]

    return (
      expectedColumn !== undefined &&
      actualColumn.name === expectedColumn.name &&
      actualColumn.type === expectedColumn.type &&
      actualColumn.notNull === expectedColumn.notNull &&
      actualColumn.primaryKey === expectedColumn.primaryKey &&
      actualColumn.defaultValue === expectedColumn.defaultValue &&
      actualColumn.hidden === expectedColumn.hidden
    )
  })
}

function foreignKey(
  tableName: string,
  from: string,
  toTable: string,
  to: string
): ForeignKeyContract {
  return Object.freeze({
    tableName,
    from,
    toTable,
    to,
    onUpdate: 'RESTRICT',
    onDelete: 'RESTRICT'
  })
}

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({
    name,
    columns: Object.freeze([...columns])
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

function integerOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'INTEGER', 0, 0)
}

function realRequired(name: string): SchemaVersion1ColumnContract {
  return column(name, 'REAL', 1, 0)
}

function realOptional(name: string): SchemaVersion1ColumnContract {
  return column(name, 'REAL', 0, 0)
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

function arraysEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  )
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSchemaSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}
