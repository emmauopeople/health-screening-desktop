import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { readDataProperties } from '../screening-encounter'
import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  normalizeFoodName,
  parseFoodDraftOwnershipInput,
  parseFoodDraftUpdateInput
} from './food-validation'
import type {
  FoodCatalogItemRecord,
  FoodDraftRecord,
  FoodDraftRowInput,
  FoodDraftRowRecord,
  FoodDraftUpdateInput,
  FoodDraftUpdateResult,
  FoodFrequencyCode,
  FoodRecentSuggestionRecord,
  FoodRepository,
  FoodSourceType
} from './food-types'

interface ReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const draftColumns = `
  id,
  encounter_id,
  patient_id,
  screening_session_id,
  location_id,
  installation_id,
  period_start,
  period_end,
  food_response,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
`

const rowColumns = `
  id,
  food_draft_id,
  sequence_number,
  catalog_code,
  food_name_snapshot,
  food_name_normalized,
  frequency_code,
  preparation_note,
  source_type,
  created_by,
  created_at,
  updated_by,
  updated_at
`

export function createFoodRepository(connection: Database.Database): FoodRepository {
  const repository: FoodRepository = {
    findDraftByEncounter: (encounterId) =>
      readDraftByEncounter(connection, parseEntityId(encounterId)),
    findDraftByEncounterForWrite: (tx, encounterId) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readDraftByEncounter(tx, parseEntityId(encounterId))
    },
    insertDraft: (tx, input) => insertDraft(tx, input),
    updateDraft: (tx, input) => updateDraft(tx, input),
    listActiveCatalogItems: () => listActiveCatalogItems(connection),
    listActiveCatalogItemsForWrite: (tx) => {
      assertActiveDatabaseTransactionConnection(tx)
      return listActiveCatalogItems(tx)
    },
    listRecentPatientFoods: (patientId, currentEncounterId) =>
      listRecentPatientFoods(
        connection,
        parseEntityId(patientId),
        parseEntityId(currentEncounterId)
      ),
    listRecentPatientFoodsForWrite: (tx, patientId, currentEncounterId) => {
      assertActiveDatabaseTransactionConnection(tx)
      return listRecentPatientFoods(tx, parseEntityId(patientId), parseEntityId(currentEncounterId))
    }
  }
  return Object.freeze(repository)
}

function insertDraft(
  tx: DatabaseTransactionConnection,
  input: Parameters<FoodRepository['insertDraft']>[1]
): FoodDraftRecord {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const parsed = parseFoodDraftOwnershipInput(input)
    tx.prepare(
      `INSERT INTO food_drafts (
        id,
        encounter_id,
        patient_id,
        screening_session_id,
        location_id,
        installation_id,
        period_start,
        period_end,
        food_response,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1)`
    ).run(
      parsed.id,
      parsed.encounterId,
      parsed.patientId,
      parsed.screeningSessionId,
      parsed.locationId,
      parsed.installationId,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.actorId,
      parsed.occurredAt,
      parsed.actorId,
      parsed.occurredAt
    )
    return (
      readDraftById(tx, parsed.id) ??
      (() => {
        throw new RepositoryDataIntegrityError()
      })()
    )
  } catch (error) {
    throw mapWriteError(error)
  }
}

function updateDraft(
  tx: DatabaseTransactionConnection,
  input: FoodDraftUpdateInput
): FoodDraftUpdateResult {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const parsed = parseFoodDraftUpdateInput(input)
    const current = readDraftById(tx, parsed.id)
    if (!current) return { status: 'NOT_FOUND' }

    const resolvedRows = resolveRowsForPersistence(tx, current, parsed.rows)
    const resolved = Object.freeze({ ...parsed, rows: resolvedRows })
    if (current.rowVersion !== parsed.expectedRowVersion) {
      if (isDraftEquivalent(current, resolved)) return { status: 'UNCHANGED', draft: current }
      return { status: 'VERSION_CONFLICT', draft: current }
    }
    if (isDraftEquivalent(current, resolved)) return { status: 'UNCHANGED', draft: current }

    const result = tx
      .prepare(
        'UPDATE food_drafts SET food_response = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?'
      )
      .run(
        parsed.foodResponse,
        parsed.actorId,
        parsed.occurredAt,
        parsed.id,
        parsed.expectedRowVersion
      )
    if (result.changes !== 1) return { status: 'VERSION_CONFLICT', draft: current }
    reconcileRows(tx, current.id, resolved.rows, parsed.actorId, parsed.occurredAt)
    return {
      status: 'UPDATED',
      draft:
        readDraftById(tx, parsed.id) ??
        (() => {
          throw new RepositoryDataIntegrityError()
        })()
    }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function resolveRowsForPersistence(
  tx: DatabaseTransactionConnection,
  current: FoodDraftRecord,
  rows: readonly FoodDraftRowInput[]
): readonly FoodDraftRowInput[] {
  const storedById = new Map(current.rows.map((row) => [row.id, row]))
  const resolvedRows = rows.map((row) => resolveRowForPersistence(tx, storedById, current.id, row))
  validateDistinctResolvedFoodNames(resolvedRows)
  return Object.freeze(resolvedRows)
}

function resolveRowForPersistence(
  tx: DatabaseTransactionConnection,
  storedById: ReadonlyMap<EntityId, FoodDraftRowRecord>,
  draftId: EntityId,
  row: FoodDraftRowInput
): FoodDraftRowInput {
  const stored = storedById.get(row.id)
  if (stored !== undefined && stored.foodDraftId !== draftId) throw new RepositoryValidationError()

  const owner = tx.prepare('SELECT food_draft_id FROM food_draft_rows WHERE id = ?').get(row.id) as
    { food_draft_id?: unknown } | undefined
  if (owner !== undefined && owner.food_draft_id !== draftId) throw new RepositoryValidationError()

  if (row.catalogCode === null) return row

  const catalogItem = readCatalogItemByCode(tx, row.catalogCode)
  if (!catalogItem) throw new RepositoryValidationError()

  if (stored !== undefined && stored.catalogCode === row.catalogCode) {
    return Object.freeze({
      ...row,
      foodNameSnapshot: stored.foodNameSnapshot
    })
  }

  if (!catalogItem.isActive) throw new RepositoryValidationError()
  const requested = normalizeFoodName(row.foodNameSnapshot)
  if (requested.snapshot !== catalogItem.displayName) throw new RepositoryValidationError()

  return Object.freeze({
    ...row,
    foodNameSnapshot: catalogItem.displayName
  })
}

function validateDistinctResolvedFoodNames(rows: readonly FoodDraftRowInput[]): void {
  const normalizedNames = new Set<string>()
  for (const row of rows) {
    const normalized = normalizeFoodName(row.foodNameSnapshot).normalized
    if (normalizedNames.has(normalized)) throw new RepositoryValidationError()
    normalizedNames.add(normalized)
  }
}

function readCatalogItemByCode(
  tx: DatabaseTransactionConnection,
  code: string
): FoodCatalogItemRecord | null {
  const row = tx
    .prepare(
      'SELECT code, display_name, normalized_search_name, is_active, sort_order, created_at, updated_at FROM food_catalog_items WHERE code = ?'
    )
    .get(code)
  return row === undefined ? null : decodeCatalogItem(row)
}

function reconcileRows(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  rows: readonly FoodDraftRowInput[],
  actorId: EntityId,
  at: string
): void {
  const stored = tx
    .prepare('SELECT * FROM food_draft_rows WHERE food_draft_id = ? ORDER BY sequence_number')
    .all(draftId) as Record<string, unknown>[]
  const storedById = new Map(stored.map((row) => [String(row.id), row]))
  const sequenceChangingExistingRows: FoodDraftRowInput[] = []
  const changedExistingRows: FoodDraftRowInput[] = []
  const newRows: FoodDraftRowInput[] = []
  for (const row of rows) {
    const old = storedById.get(row.id)
    if (!old) {
      newRows.push(row)
      continue
    }
    if (Number(old.sequence_number) !== row.sequenceNumber) sequenceChangingExistingRows.push(row)
    if (!sameStoredRow(old, row)) changedExistingRows.push(row)
  }

  const temporarySequences = allocateTemporarySequences(
    stored,
    rows,
    sequenceChangingExistingRows.length
  )
  let temporarySequenceIndex = 0
  for (const row of sequenceChangingExistingRows) {
    tx.prepare(
      'UPDATE food_draft_rows SET sequence_number = ? WHERE id = ? AND food_draft_id = ?'
    ).run(temporarySequences[temporarySequenceIndex], row.id, draftId)
    temporarySequenceIndex += 1
  }

  const submitted = new Set(rows.map((row) => String(row.id)))
  for (const old of stored) {
    if (!submitted.has(String(old.id))) {
      tx.prepare('DELETE FROM food_draft_rows WHERE id = ? AND food_draft_id = ?').run(
        old.id,
        draftId
      )
    }
  }
  for (const row of changedExistingRows) updateRow(tx, draftId, row, actorId, at)
  for (const row of newRows) insertRow(tx, draftId, row, actorId, at)
}

function updateRow(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  row: FoodDraftRowInput,
  actorId: EntityId,
  at: string
): void {
  const normalized = normalizeFoodName(row.foodNameSnapshot)
  tx.prepare(
    `UPDATE food_draft_rows
     SET sequence_number = ?,
         catalog_code = ?,
         food_name_snapshot = ?,
         food_name_normalized = ?,
         frequency_code = ?,
         preparation_note = ?,
         source_type = ?,
         updated_by = ?,
         updated_at = ?
     WHERE id = ? AND food_draft_id = ?`
  ).run(
    row.sequenceNumber,
    row.catalogCode,
    normalized.snapshot,
    normalized.normalized,
    row.frequencyCode,
    row.preparationNote,
    row.sourceType,
    actorId,
    at,
    row.id,
    draftId
  )
}

function insertRow(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  row: FoodDraftRowInput,
  actorId: EntityId,
  at: string
): void {
  const normalized = normalizeFoodName(row.foodNameSnapshot)
  tx.prepare(
    `INSERT INTO food_draft_rows (
      id,
      food_draft_id,
      sequence_number,
      catalog_code,
      food_name_snapshot,
      food_name_normalized,
      frequency_code,
      preparation_note,
      source_type,
      created_by,
      created_at,
      updated_by,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    draftId,
    row.sequenceNumber,
    row.catalogCode,
    normalized.snapshot,
    normalized.normalized,
    row.frequencyCode,
    row.preparationNote,
    row.sourceType,
    actorId,
    at,
    actorId,
    at
  )
}

function allocateTemporarySequences(
  storedRows: readonly Record<string, unknown>[],
  submittedRows: readonly FoodDraftRowInput[],
  count: number
): readonly number[] {
  if (count === 0) return Object.freeze([])
  const maxStoredSequence = storedRows.reduce(
    (max, row) => Math.max(max, parseStoredSequence(row.sequence_number)),
    0
  )
  const maxSubmittedSequence = submittedRows.reduce(
    (max, row) => Math.max(max, row.sequenceNumber),
    0
  )
  const firstTemporarySequence = Math.max(maxStoredSequence, maxSubmittedSequence) + 1
  const lastTemporarySequence = firstTemporarySequence + count - 1
  if (
    !Number.isSafeInteger(firstTemporarySequence) ||
    !Number.isSafeInteger(lastTemporarySequence) ||
    firstTemporarySequence <= 0 ||
    lastTemporarySequence > Number.MAX_SAFE_INTEGER
  )
    throw new RepositoryValidationError()
  return Object.freeze(Array.from({ length: count }, (_, index) => firstTemporarySequence + index))
}

function parseStoredSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new RepositoryDataIntegrityError()
  return value
}

function isDraftEquivalent(current: FoodDraftRecord, next: FoodDraftUpdateInput): boolean {
  return (
    current.foodResponse === next.foodResponse &&
    current.rows.length === next.rows.length &&
    current.rows.every((row, index) => {
      const candidate = next.rows[index]
      return candidate !== undefined && sameRecordAndInput(row, candidate)
    })
  )
}

function sameRecordAndInput(record: FoodDraftRowRecord, input: FoodDraftRowInput): boolean {
  const normalized = normalizeFoodName(input.foodNameSnapshot)
  return (
    record.id === input.id &&
    record.sequenceNumber === input.sequenceNumber &&
    record.catalogCode === input.catalogCode &&
    record.foodNameSnapshot === normalized.snapshot &&
    record.foodNameNormalized === normalized.normalized &&
    record.frequencyCode === input.frequencyCode &&
    record.preparationNote === input.preparationNote &&
    record.sourceType === input.sourceType
  )
}

function sameStoredRow(stored: Record<string, unknown>, input: FoodDraftRowInput): boolean {
  const normalized = normalizeFoodName(input.foodNameSnapshot)
  return (
    Number(stored.sequence_number) === input.sequenceNumber &&
    stored.catalog_code === input.catalogCode &&
    stored.food_name_snapshot === normalized.snapshot &&
    stored.food_name_normalized === normalized.normalized &&
    stored.frequency_code === input.frequencyCode &&
    stored.preparation_note === input.preparationNote &&
    stored.source_type === input.sourceType
  )
}

function readDraftByEncounter(
  connection: ReadConnection,
  encounterId: EntityId
): FoodDraftRecord | null {
  const row = connection
    .prepare(`SELECT ${draftColumns} FROM food_drafts WHERE encounter_id = ?`)
    .get(encounterId)
  return row === undefined ? null : decodeDraft(connection, row)
}

function readDraftById(connection: ReadConnection, id: EntityId): FoodDraftRecord | null {
  const row = connection.prepare(`SELECT ${draftColumns} FROM food_drafts WHERE id = ?`).get(id)
  return row === undefined ? null : decodeDraft(connection, row)
}

function decodeDraft(connection: ReadConnection, row: unknown): FoodDraftRecord {
  try {
    const data = readDataProperties(row, [
      'id',
      'encounter_id',
      'patient_id',
      'screening_session_id',
      'location_id',
      'installation_id',
      'period_start',
      'period_end',
      'food_response',
      'created_by',
      'created_at',
      'updated_by',
      'updated_at',
      'row_version'
    ] as const)
    const id = parseEntityId(data.id)
    return Object.freeze({
      id,
      encounterId: parseEntityId(data.encounter_id),
      patientId: parseEntityId(data.patient_id),
      screeningSessionId: parseEntityId(data.screening_session_id),
      locationId: parseEntityId(data.location_id),
      installationId: parseEntityId(data.installation_id),
      periodStart: String(data.period_start) as FoodDraftRecord['periodStart'],
      periodEnd: String(data.period_end) as FoodDraftRecord['periodEnd'],
      foodResponse: data.food_response as FoodDraftRecord['foodResponse'],
      createdBy: parseEntityId(data.created_by),
      createdAt: parseUtcTimestamp(data.created_at),
      updatedBy: parseEntityId(data.updated_by),
      updatedAt: parseUtcTimestamp(data.updated_at),
      rowVersion: parseStoredPositiveInteger(data.row_version),
      rows: Object.freeze(readRows(connection, id))
    })
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function readRows(connection: ReadConnection, draftId: EntityId): readonly FoodDraftRowRecord[] {
  return (
    connection
      .prepare(
        `SELECT ${rowColumns} FROM food_draft_rows WHERE food_draft_id = ? ORDER BY sequence_number`
      )
      .all(draftId) as readonly unknown[]
  ).map(decodeRow)
}

function decodeRow(row: unknown): FoodDraftRowRecord {
  const data = readDataProperties(row, [
    'id',
    'food_draft_id',
    'sequence_number',
    'catalog_code',
    'food_name_snapshot',
    'food_name_normalized',
    'frequency_code',
    'preparation_note',
    'source_type',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at'
  ] as const)
  return Object.freeze({
    id: parseEntityId(data.id),
    foodDraftId: parseEntityId(data.food_draft_id),
    sequenceNumber: parseStoredPositiveInteger(data.sequence_number),
    catalogCode: data.catalog_code === null ? null : String(data.catalog_code),
    foodNameSnapshot: String(data.food_name_snapshot),
    foodNameNormalized: String(data.food_name_normalized),
    frequencyCode: data.frequency_code as FoodFrequencyCode | null,
    preparationNote: data.preparation_note === null ? null : String(data.preparation_note),
    sourceType: data.source_type as FoodSourceType,
    createdBy: parseEntityId(data.created_by),
    createdAt: parseUtcTimestamp(data.created_at),
    updatedBy: parseEntityId(data.updated_by),
    updatedAt: parseUtcTimestamp(data.updated_at)
  })
}

function listActiveCatalogItems(connection: ReadConnection): readonly FoodCatalogItemRecord[] {
  try {
    return Object.freeze(
      (
        connection
          .prepare(
            'SELECT code, display_name, normalized_search_name, is_active, sort_order, created_at, updated_at FROM food_catalog_items WHERE is_active = 1 ORDER BY sort_order, code'
          )
          .all() as readonly unknown[]
      ).map(decodeCatalogItem)
    )
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function decodeCatalogItem(row: unknown): FoodCatalogItemRecord {
  const data = readDataProperties(row, [
    'code',
    'display_name',
    'normalized_search_name',
    'is_active',
    'sort_order',
    'created_at',
    'updated_at'
  ] as const)
  return Object.freeze({
    code: String(data.code),
    displayName: String(data.display_name),
    normalizedSearchName: String(data.normalized_search_name),
    isActive: Number(data.is_active) === 1,
    sortOrder: parseStoredPositiveInteger(data.sort_order),
    createdAt: parseUtcTimestamp(data.created_at),
    updatedAt: parseUtcTimestamp(data.updated_at)
  })
}

function listRecentPatientFoods(
  connection: ReadConnection,
  patientId: EntityId,
  currentEncounterId: EntityId
): readonly FoodRecentSuggestionRecord[] {
  try {
    return Object.freeze(
      (
        connection
          .prepare(
            `SELECT food_code, active_catalog_code, food_name, food_name_normalized, recorded_at
             FROM (
               SELECT
                 food_logs.food_code,
                 food_catalog_items.code AS active_catalog_code,
                 food_logs.food_name,
                 food_logs.food_name_normalized,
                 food_logs.recorded_at,
                 row_number() OVER (
                   PARTITION BY lower(food_logs.food_name_normalized)
                   ORDER BY food_logs.recorded_at DESC, food_logs.id DESC
                 ) AS occurrence_rank
               FROM food_logs
               INNER JOIN screening_encounters
                 ON screening_encounters.id = food_logs.encounter_id
               LEFT JOIN food_catalog_items
                 ON food_catalog_items.code = food_logs.food_code
                AND food_catalog_items.is_active = 1
               WHERE screening_encounters.patient_id = ?
                 AND screening_encounters.id <> ?
                 AND screening_encounters.status = 'COMPLETED'
             )
             WHERE occurrence_rank = 1
             ORDER BY recorded_at DESC, lower(food_name_normalized), food_name
             LIMIT 8`
          )
          .all(patientId, currentEncounterId) as readonly unknown[]
      ).map(decodeRecentSuggestion)
    )
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function decodeRecentSuggestion(row: unknown): FoodRecentSuggestionRecord {
  const data = readDataProperties(row, [
    'food_code',
    'active_catalog_code',
    'food_name',
    'food_name_normalized',
    'recorded_at'
  ] as const)
  return Object.freeze({
    catalogCode: data.active_catalog_code === null ? null : String(data.food_code),
    foodNameSnapshot: String(data.food_name),
    foodNameNormalized: String(data.food_name_normalized),
    lastRecordedAt: parseUtcTimestamp(data.recorded_at)
  })
}

function parseStoredPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new RepositoryReadError()
  return value
}

function mapWriteError(error: unknown): Error {
  if (
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof RepositoryReadError
  )
    return error
  return new RepositoryWriteError(getRepositoryErrorType(error))
}
