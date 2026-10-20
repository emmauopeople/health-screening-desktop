import type Database from 'better-sqlite3'
import type { DatabaseTransactionConnection } from '../transaction'
import { assertActiveDatabaseTransactionConnection } from '../transaction/transaction-capability'
import type { HistoryItem, HistoryPage } from '@shared/central-history/contract.mjs'

export interface CentralHistoryIdentity {
  installation_id: string
  location_id: string
  location_revision: number
  person_id: string
  chs_medical_id: string
  patient_revision: number
  accepted_revision: number
  user_role: string
  user_active: number
  user_password_change: number
  user_created_at: string
}
export interface HistorySnapshot {
  id: string
  patient_id: string
  owner_user_id: string
  binding_key: string
  state: 'DOWNLOADING' | 'READY'
  reason_code: string
  from_date: string
  to_date: string
  retrieved_at: string | null
  patient_json: string | null
  next_cursor: string | null
  page_count: number
  item_count: number
  byte_count: number
  created_at: string
  updated_at: string
}

export interface CentralHistoryRepository {
  identity(patientId: string, userId: string): CentralHistoryIdentity | undefined
  snapshot(
    patientId: string,
    ownerId: string,
    state: HistorySnapshot['state']
  ): HistorySnapshot | undefined
  rows(snapshotId: string, offset: number, type?: string): { item_json: string }[]
  count(snapshotId: string, type?: string): number
  lastItem(snapshotId: string): HistoryItem | undefined
  contains(snapshotId: string, item: HistoryItem): boolean
  remove(
    tx: DatabaseTransactionConnection,
    patientId: string,
    ownerId: string,
    state?: HistorySnapshot['state']
  ): void
  invalidateAccess(tx: DatabaseTransactionConnection): void
  start(tx: DatabaseTransactionConnection, snapshot: HistorySnapshot): void
  append(
    tx: DatabaseTransactionConnection,
    snapshot: HistorySnapshot,
    page: HistoryPage,
    bytes: number,
    now: string
  ): void
}

export function createCentralHistoryRepository(
  connection: Database.Database
): CentralHistoryRepository {
  return {
    identity(patientId: string, userId: string): CentralHistoryIdentity | undefined {
      return connection
        .prepare<[string, string], CentralHistoryIdentity>(
          `
        SELECT i.id installation_id, c.location_id, c.row_version location_revision,
          l.central_person_id person_id, l.chs_medical_id, p.row_version patient_revision,
          l.source_revision accepted_revision, u.role user_role, u.is_active user_active,
          u.must_change_password user_password_change, u.created_at user_created_at
        FROM patients p
        JOIN sync_patient_identity_links l ON l.patient_id = p.id
        JOIN patient_identifiers pi ON pi.patient_id = p.id
          AND pi.identifier_type = 'CHS_MEDICAL_ID' AND pi.identifier_value = l.chs_medical_id
          AND pi.status = 'ACTIVE'
        JOIN installation i ON i.singleton_id = 1
        JOIN installation_location_configuration c ON c.installation_id = i.id
        JOIN locations loc ON loc.id = c.location_id AND loc.is_active = 1
        JOIN users u ON u.id = ?
        WHERE p.id = ?
      `
        )
        .get(userId, patientId)
    },
    snapshot(
      patientId: string,
      ownerId: string,
      state: HistorySnapshot['state']
    ): HistorySnapshot | undefined {
      return connection
        .prepare<[string, string, string], HistorySnapshot>(
          `
        SELECT * FROM central_history_snapshots WHERE patient_id = ? AND owner_user_id = ? AND state = ?
      `
        )
        .get(patientId, ownerId, state)
    },
    rows(snapshotId: string, offset: number, type?: string): { item_json: string }[] {
      return connection
        .prepare(
          `
        SELECT item_json FROM central_history_items
        WHERE snapshot_id = ? AND (? IS NULL OR resource_type = ?)
        ORDER BY position LIMIT 25 OFFSET ?
      `
        )
        .all(snapshotId, type ?? null, type ?? null, offset) as { item_json: string }[]
    },
    count(snapshotId: string, type?: string): number {
      return (
        connection
          .prepare(
            `SELECT COUNT(*) n FROM central_history_items
        WHERE snapshot_id = ? AND (? IS NULL OR resource_type = ?)`
          )
          .get(snapshotId, type ?? null, type ?? null) as { n: number }
      ).n
    },
    lastItem(snapshotId: string): HistoryItem | undefined {
      const row = connection
        .prepare(
          `SELECT item_json FROM central_history_items
        WHERE snapshot_id = ? ORDER BY position DESC LIMIT 1`
        )
        .get(snapshotId) as { item_json: string } | undefined
      return row === undefined ? undefined : (JSON.parse(row.item_json) as HistoryItem)
    },
    contains(snapshotId: string, item: HistoryItem): boolean {
      return (
        connection
          .prepare(
            'SELECT 1 FROM central_history_items WHERE snapshot_id = ? AND resource_type = ? AND resource_id = ?'
          )
          .get(snapshotId, item.resourceType, item.resourceId) !== undefined
      )
    },
    remove(
      tx: DatabaseTransactionConnection,
      patientId: string,
      ownerId: string,
      state?: HistorySnapshot['state']
    ): void {
      assertActiveDatabaseTransactionConnection(tx)
      tx.prepare(
        `DELETE FROM central_history_snapshots WHERE patient_id = ? AND owner_user_id = ?
        AND (? IS NULL OR state = ?)`
      ).run(patientId, ownerId, state ?? null, state ?? null)
    },
    invalidateAccess(tx: DatabaseTransactionConnection): void {
      assertActiveDatabaseTransactionConnection(tx)
      tx.prepare('DELETE FROM central_history_snapshots').run()
    },
    start(tx: DatabaseTransactionConnection, snapshot: HistorySnapshot): void {
      assertActiveDatabaseTransactionConnection(tx)
      tx.prepare(
        `INSERT INTO central_history_snapshots (
        id, patient_id, owner_user_id, binding_key, state, reason_code, from_date, to_date,
        retrieved_at, patient_json, next_cursor, page_count, item_count, byte_count, created_at, updated_at
      ) VALUES (@id, @patient_id, @owner_user_id, @binding_key, @state, @reason_code, @from_date, @to_date,
        @retrieved_at, @patient_json, @next_cursor, @page_count, @item_count, @byte_count, @created_at, @updated_at)
      `
      ).run(snapshot)
    },
    append(
      tx: DatabaseTransactionConnection,
      snapshot: HistorySnapshot,
      page: HistoryPage,
      bytes: number,
      now: string
    ): void {
      assertActiveDatabaseTransactionConnection(tx)
      const current = tx
        .prepare(
          `SELECT page_count, next_cursor FROM central_history_snapshots
        WHERE id = ? AND state = 'DOWNLOADING'`
        )
        .get(snapshot.id) as { page_count: number; next_cursor: string | null } | undefined
      if (
        !current ||
        current.page_count !== snapshot.page_count ||
        current.next_cursor !== snapshot.next_cursor
      )
        throw new Error('History snapshot changed')
      const insert =
        tx.prepare(`INSERT INTO central_history_items (snapshot_id, position, resource_type, resource_id, item_json)
        VALUES (?, ?, ?, ?, ?)`)
      page.items.forEach((item, index) =>
        insert.run(
          snapshot.id,
          snapshot.item_count + index,
          item.resourceType,
          item.resourceId,
          JSON.stringify(item)
        )
      )
      tx.prepare(
        `UPDATE central_history_snapshots SET retrieved_at = ?, patient_json = ?, next_cursor = ?,
        page_count = page_count + 1, item_count = item_count + ?, byte_count = byte_count + ?, updated_at = ? WHERE id = ?`
      ).run(
        page.retrievedAt,
        JSON.stringify(page.patient),
        page.nextCursor,
        page.items.length,
        bytes,
        now,
        snapshot.id
      )
      if (page.nextCursor === null) {
        tx.prepare(
          `DELETE FROM central_history_snapshots WHERE patient_id = ? AND owner_user_id = ? AND state = 'READY'`
        ).run(snapshot.patient_id, snapshot.owner_user_id)
        tx.prepare("UPDATE central_history_snapshots SET state = 'READY' WHERE id = ?").run(
          snapshot.id
        )
      }
      // Bound the whole cache to 128 MiB. Preserve this patient's last complete copy
      // until replacement, evicting the oldest other snapshots first.
      const victims = tx
        .prepare(
          `SELECT id, byte_count FROM central_history_snapshots
        WHERE NOT (patient_id = ? AND owner_user_id = ?) ORDER BY updated_at, id`
        )
        .all(snapshot.patient_id, snapshot.owner_user_id) as { id: string; byte_count: number }[]
      let total = (
        tx
          .prepare('SELECT COALESCE(SUM(byte_count), 0) n FROM central_history_snapshots')
          .get() as { n: number }
      ).n
      for (const victim of victims) {
        if (total <= 128 * 1024 * 1024) break
        tx.prepare('DELETE FROM central_history_snapshots WHERE id = ?').run(victim.id)
        total -= victim.byte_count
      }
    }
  }
}
