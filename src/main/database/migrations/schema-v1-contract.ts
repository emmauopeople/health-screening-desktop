import {
  MigrationCompatibilityError,
  MigrationExecutionError,
  type DatabaseSchemaValidationMode,
  type MigrationConnection
} from './migration-types'

type SqliteStorageType = 'INTEGER' | 'REAL' | 'TEXT'

export interface SchemaVersion1ColumnContract {
  name: string
  type: SqliteStorageType
  notNull: 0 | 1
  primaryKey: number
  defaultValue: null | string
  hidden: number
}

export interface SchemaVersion1TableContract {
  name: string
  columns: readonly SchemaVersion1ColumnContract[]
}

interface SqliteTableListRow {
  schema: unknown
  name: unknown
  type: unknown
  strict: unknown
}

interface SqliteColumnInfoRow {
  name: unknown
  type: unknown
  notnull: unknown
  dflt_value: unknown
  pk: unknown
  hidden: unknown
}

interface SqliteNameRow {
  name: unknown
}

interface SqliteSqlRow {
  sql: unknown
}

const textPk = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 1)
const integerPk = (name: string): SchemaVersion1ColumnContract => column(name, 'INTEGER', 0, 1)
const textRequired = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 1, 0)
const textOptional = (name: string): SchemaVersion1ColumnContract => column(name, 'TEXT', 0, 0)
const integerRequired = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 1, 0)
const integerOptional = (name: string): SchemaVersion1ColumnContract =>
  column(name, 'INTEGER', 0, 0)

export const createSchemaMigrationsTableSql = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL,
  application_version TEXT NOT NULL
) STRICT;
`

export const schemaVersion1TableContracts = Object.freeze([
  table('app_settings', [
    textPk('key'),
    textRequired('value_json'),
    textRequired('updated_at'),
    textRequired('sensitivity_classification')
  ]),
  table('audit_log', [
    textPk('id'),
    textRequired('installation_id'),
    textOptional('user_id'),
    textRequired('action'),
    textRequired('entity_type'),
    textOptional('entity_id'),
    textRequired('occurred_at'),
    textRequired('metadata_json')
  ]),
  table('blood_pressure_readings', [
    textPk('id'),
    textRequired('encounter_id'),
    integerRequired('sequence_number'),
    integerRequired('systolic'),
    integerRequired('diastolic'),
    integerOptional('pulse'),
    textOptional('arm'),
    textOptional('body_position'),
    textOptional('cuff_size'),
    textOptional('device_identifier'),
    textRequired('measured_at'),
    textRequired('status'),
    textOptional('discard_reason'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('consent_records', [
    textPk('id'),
    textRequired('patient_id'),
    textRequired('consent_type'),
    textRequired('status'),
    textRequired('source_type'),
    textOptional('effective_at'),
    textOptional('withdrawn_at'),
    textOptional('notes'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('followups', [
    textPk('id'),
    textRequired('referral_id'),
    textRequired('contact_date'),
    textRequired('contact_method'),
    textRequired('information_source'),
    integerOptional('provider_seen'),
    textOptional('facility_name'),
    textOptional('date_seen'),
    textOptional('reported_outcome'),
    textOptional('reported_medications_or_advice'),
    textOptional('next_action'),
    textOptional('next_followup_date'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('food_logs', [
    textPk('id'),
    textRequired('encounter_id'),
    textOptional('food_code'),
    textRequired('food_name'),
    textRequired('food_name_normalized'),
    textOptional('frequency_code'),
    textOptional('notes'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('installation', [
    integerPk('singleton_id'),
    textRequired('id'),
    textRequired('deployment_name'),
    textRequired('timezone'),
    textRequired('created_at'),
    textRequired('updated_at')
  ]),
  table('lifestyle_logs', [
    textPk('id'),
    textRequired('encounter_id'),
    textRequired('question_code'),
    textOptional('response_code'),
    textOptional('response_text'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('locations', [
    textPk('id'),
    textRequired('name'),
    textRequired('name_normalized'),
    textRequired('location_type'),
    textOptional('village'),
    textOptional('subdivision'),
    textOptional('region'),
    textOptional('directions'),
    integerRequired('is_active'),
    textRequired('created_by'),
    textRequired('created_at'),
    textRequired('updated_by'),
    textRequired('updated_at')
  ]),
  table('otc_medication_logs', [
    textPk('id'),
    textRequired('encounter_id'),
    textRequired('product_name'),
    textRequired('product_name_normalized'),
    textRequired('reason_for_use'),
    textOptional('dose_text'),
    textOptional('frequency_text'),
    textOptional('duration_text'),
    textOptional('source_of_medication'),
    integerOptional('currently_taking'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    textRequired('recorded_at')
  ]),
  table('patient_identifiers', [
    textPk('id'),
    textRequired('patient_id'),
    textRequired('identifier_type'),
    textRequired('issuer'),
    textRequired('identifier_value'),
    integerRequired('is_primary'),
    textOptional('valid_from'),
    textOptional('valid_to'),
    textRequired('created_by'),
    textRequired('created_at')
  ]),
  table('patients', [
    textPk('id'),
    textRequired('patient_code'),
    textRequired('display_name'),
    textOptional('given_name'),
    textOptional('family_name'),
    textOptional('other_names'),
    textRequired('name_normalized'),
    textOptional('sex'),
    textOptional('date_of_birth'),
    integerOptional('approximate_age_years'),
    textOptional('age_as_of_date'),
    textOptional('phone'),
    textOptional('phone_normalized'),
    textOptional('alternate_contact_name'),
    textOptional('alternate_contact_phone'),
    textOptional('village'),
    textOptional('quarter'),
    textOptional('residence_notes'),
    textRequired('status'),
    textRequired('created_by'),
    textRequired('created_at'),
    textRequired('updated_by'),
    textRequired('updated_at')
  ]),
  table('protocol_versions', [
    textPk('id'),
    textRequired('protocol_key'),
    textRequired('version_label'),
    textRequired('status'),
    textOptional('effective_at'),
    textRequired('configuration_json'),
    textRequired('checksum'),
    textOptional('imported_by'),
    textRequired('imported_at'),
    textOptional('activated_by'),
    textOptional('activated_at'),
    textRequired('created_at')
  ]),
  table('referral_status_history', [
    textPk('id'),
    textRequired('referral_id'),
    textOptional('from_status'),
    textRequired('to_status'),
    textOptional('change_reason'),
    textRequired('changed_by'),
    textRequired('changed_at')
  ]),
  table('referrals', [
    textPk('id'),
    textRequired('patient_id'),
    textRequired('encounter_id'),
    textRequired('protocol_version_id'),
    textRequired('reason_codes_json'),
    textOptional('reason_text'),
    textRequired('urgency'),
    textOptional('destination_name'),
    textOptional('due_date'),
    textRequired('status'),
    textRequired('created_by'),
    textRequired('created_at'),
    textOptional('printed_at'),
    textOptional('closed_by'),
    textOptional('closed_at'),
    textOptional('closure_reason'),
    integerRequired('record_version'),
    textRequired('updated_at')
  ]),
  table('schema_migrations', [
    integerPk('version'),
    textRequired('name'),
    textRequired('checksum'),
    textRequired('applied_at'),
    textRequired('application_version')
  ]),
  table('screening_encounters', [
    textPk('id'),
    textRequired('patient_id'),
    textRequired('screening_session_id'),
    textRequired('location_id'),
    textRequired('protocol_version_id'),
    textRequired('status'),
    textRequired('started_at'),
    textOptional('completed_at'),
    textRequired('source_type'),
    textRequired('recorded_by'),
    integerOptional('summary_systolic'),
    integerOptional('summary_diastolic'),
    integerOptional('summary_pulse'),
    textOptional('next_action_category'),
    textOptional('decision_json'),
    textOptional('amendment_of_encounter_id'),
    textOptional('amendment_reason'),
    textOptional('void_reason'),
    integerRequired('record_version'),
    textRequired('created_at'),
    textRequired('updated_at')
  ]),
  table('screening_sessions', [
    textPk('id'),
    textRequired('location_id'),
    textRequired('protocol_version_id'),
    textRequired('session_date'),
    textRequired('status'),
    textRequired('created_by'),
    textRequired('created_at'),
    textRequired('opened_at'),
    textOptional('closed_by'),
    textOptional('closed_at'),
    textRequired('updated_at')
  ]),
  table('sync_attempts', [
    textPk('id'),
    textRequired('batch_id'),
    textRequired('started_at'),
    textOptional('ended_at'),
    textRequired('status'),
    textRequired('item_counts_json'),
    textOptional('error_summary')
  ]),
  table('sync_outbox', [
    textPk('id'),
    textRequired('aggregate_type'),
    textRequired('aggregate_id'),
    textRequired('operation'),
    textRequired('payload_json'),
    textRequired('payload_schema_version'),
    textRequired('created_at'),
    textRequired('status'),
    integerRequired('attempt_count'),
    textOptional('next_attempt_at'),
    textOptional('last_error_code'),
    textOptional('last_error_message'),
    textOptional('sent_at')
  ]),
  table('users', [
    textPk('id'),
    textRequired('username'),
    textRequired('username_normalized'),
    textRequired('display_name'),
    textRequired('password_hash'),
    textRequired('password_salt'),
    textRequired('role'),
    integerRequired('is_active'),
    integerRequired('must_change_password'),
    integerRequired('failed_login_count'),
    textOptional('locked_until'),
    textOptional('last_login_at'),
    textRequired('created_at'),
    textRequired('updated_at')
  ])
])

export const schemaVersion1TableNames = Object.freeze(
  schemaVersion1TableContracts.map((contract) => contract.name)
)

export const schemaVersion1NamedIndexes = Object.freeze([
  'ix_audit_log_entity',
  'ix_audit_log_occurred_at',
  'ix_consent_records_patient_time',
  'ix_followups_referral_contact_date',
  'ix_food_logs_encounter',
  'ix_lifestyle_logs_encounter',
  'ix_locations_name_normalized',
  'ix_otc_medication_logs_encounter',
  'ix_patient_identifiers_patient',
  'ix_patients_name_normalized',
  'ix_patients_phone_normalized',
  'ix_referral_status_history_time',
  'ix_referrals_patient_time',
  'ix_referrals_status_due_date',
  'ix_screening_encounters_patient_time',
  'ix_screening_encounters_session',
  'ix_sync_attempts_started_at',
  'ix_sync_outbox_status_next_attempt',
  'ux_bp_readings_encounter_sequence',
  'ux_patient_identifiers_identity',
  'ux_patients_patient_code',
  'ux_protocol_versions_key_version',
  'ux_protocol_versions_one_active',
  'ux_screening_sessions_location_date',
  'ux_users_username_normalized'
])

export function validateSchemaVersion1(
  connection: MigrationConnection,
  mode: DatabaseSchemaValidationMode
): void {
  if (!isSchemaVersion1Valid(connection)) {
    throwSchemaValidationError(mode)
  }
}

function isSchemaVersion1Valid(connection: MigrationConnection): boolean {
  try {
    return (
      isForeignKeyEnforcementEnabled(connection) &&
      hasExactTableNames(connection) &&
      hasExactStrictTables(connection) &&
      hasExactNamedIndexes(connection) &&
      hasExactColumns(connection) &&
      hasExactSchemaMigrationsSql(connection)
    )
  } catch {
    return false
  }
}

function hasExactTableNames(connection: MigrationConnection): boolean {
  return arraysEqual(readNonInternalTableNames(connection), schemaVersion1TableNames)
}

function hasExactStrictTables(connection: MigrationConnection): boolean {
  const strictTables = new Map(
    readTableList(connection)
      .filter((row) => row.schema === 'main' && row.type === 'table')
      .map((row) => [row.name, row.strict])
  )

  return schemaVersion1TableNames.every((tableName) => strictTables.get(tableName) === 1)
}

function hasExactNamedIndexes(connection: MigrationConnection): boolean {
  return arraysEqual(readNamedIndexNames(connection), schemaVersion1NamedIndexes)
}

function hasExactColumns(connection: MigrationConnection): boolean {
  return schemaVersion1TableContracts.every((tableContract) =>
    columnsMatch(readTableColumns(connection, tableContract.name), tableContract.columns)
  )
}

function hasExactSchemaMigrationsSql(connection: MigrationConnection): boolean {
  const row = connection
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get('schema_migrations') as SqliteSqlRow | undefined

  return (
    typeof row?.sql === 'string' &&
    normalizeSchemaSql(row.sql) === normalizeSchemaSql(createSchemaMigrationsTableSql)
  )
}

function isForeignKeyEnforcementEnabled(connection: MigrationConnection): boolean {
  return connection.pragma('foreign_keys', { simple: true }) === 1
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

function readTableList(connection: MigrationConnection): ReadonlyArray<{
  schema: string
  name: string
  type: string
  strict: number
}> {
  return (connection.prepare('PRAGMA table_list').all() as SqliteTableListRow[]).map((row) => ({
    schema: String(row.schema),
    name: String(row.name),
    type: String(row.type),
    strict: Number(row.strict)
  }))
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

function table(
  name: string,
  columns: readonly SchemaVersion1ColumnContract[]
): SchemaVersion1TableContract {
  return Object.freeze({
    name,
    columns: Object.freeze([...columns])
  })
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

function throwSchemaValidationError(mode: DatabaseSchemaValidationMode): never {
  if (mode === 'execution') {
    throw new MigrationExecutionError()
  }

  throw new MigrationCompatibilityError()
}
