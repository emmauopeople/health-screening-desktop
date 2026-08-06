export type ScreeningEncounterIdentityConstraintClassification =
  | 'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
  | 'SCREENING_ENCOUNTER_ID_CONFLICT'
  | 'OTHER_UNIQUE_CONSTRAINT'
  | 'NOT_A_UNIQUE_CONSTRAINT'

const identityConstraintColumns = Object.freeze([
  'screening_encounters.screening_session_id',
  'screening_encounters.patient_id'
])

const encounterPrimaryKeyColumns = Object.freeze(['screening_encounters.id'])

export function classifyScreeningEncounterIdentityConstraintError(
  error: unknown
): ScreeningEncounterIdentityConstraintClassification {
  const sqliteError = readSqliteConstraintError(error)

  if (sqliteError === null || !isUniqueConstraintCode(sqliteError.code)) {
    return 'NOT_A_UNIQUE_CONSTRAINT'
  }

  const columns = parseUniqueConstraintColumns(sqliteError.message)

  if (columnsEqual(columns, identityConstraintColumns)) {
    return 'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
  }

  if (columnsEqual(columns, encounterPrimaryKeyColumns)) {
    return 'SCREENING_ENCOUNTER_ID_CONFLICT'
  }

  return 'OTHER_UNIQUE_CONSTRAINT'
}

function readSqliteConstraintError(error: unknown): { code: string; message: string } | null {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  let codeDescriptor: PropertyDescriptor | undefined
  let messageDescriptor: PropertyDescriptor | undefined

  try {
    codeDescriptor = Object.getOwnPropertyDescriptor(error, 'code')
    messageDescriptor = Object.getOwnPropertyDescriptor(error, 'message')
  } catch {
    return null
  }

  if (
    codeDescriptor === undefined ||
    messageDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(codeDescriptor, 'value') ||
    !Object.prototype.hasOwnProperty.call(messageDescriptor, 'value') ||
    typeof codeDescriptor.value !== 'string' ||
    typeof messageDescriptor.value !== 'string'
  ) {
    return null
  }

  return {
    code: codeDescriptor.value,
    message: messageDescriptor.value
  }
}

function isUniqueConstraintCode(code: string): boolean {
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

function parseUniqueConstraintColumns(message: string): readonly string[] {
  const prefix = 'UNIQUE constraint failed: '

  if (!message.startsWith(prefix)) {
    return []
  }

  const rawColumns = message.slice(prefix.length).split(',')
  const columns = rawColumns.map((column) => column.trim())

  if (
    columns.length === 0 ||
    columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/u.test(column))
  ) {
    return []
  }

  return columns
}

function columnsEqual(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((column, index) => column === expected[index])
  )
}
