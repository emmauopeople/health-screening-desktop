import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  createCentralHistoryRepository,
  type HistorySnapshot
} from '@main/database/repositories/central-history-repository'
import {
  createAuditEventRepository,
  parseAuditActionCode,
  parseAuditEntityType
} from '@main/database/repositories/audit-event'
import { createSyncTransportBatchRepository } from '@main/database/repositories/sync-transport'
import {
  createDatabaseTransactionExecutor,
  type DatabaseTransactionContext
} from '@main/database/transaction'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcClock } from '@main/foundation/utc-clock'
import {
  isHistoryPage,
  type HistoryItem,
  type HistoryPage
} from '@shared/central-history/contract.mjs'
import {
  centralHistoryReadRequestSchema,
  centralHistoryRefreshRequestSchema,
  type CentralHistoryReadData,
  type CentralHistoryRefreshData,
  type CentralHistoryStatus
} from '@shared/ipc/central-history-contracts'
import type { LocalAuthenticationSessionService } from '../authentication/session/local-session-types'
import { createSyncTransportFoundationService } from '../sync-transport/sync-transport-service'
import type {
  SyncCredentialProtector,
  SyncTransportCredential
} from '../sync-transport/sync-transport-types'
import {
  createHistoryHttpClient,
  historyPageByteLimit,
  type HistoryHttpClient
} from './history-http-client'

class HistoryFailure extends Error {
  constructor(readonly status: CentralHistoryStatus) {
    super(status)
  }
}
interface AccessContext {
  patientId: string
  userId: string
  installationId: string
  personId: string
  chsMedicalId: string
  binding: string
  authenticatedAt: string
  credential: SyncTransportCredential
}

export interface CentralHistoryService {
  read(request: unknown): CentralHistoryReadData
  refresh(request: unknown): Promise<CentralHistoryRefreshData>
}

export function createCentralHistoryService({
  connection,
  authenticationSessionService: auth,
  credentialProtector,
  httpClient = createHistoryHttpClient(),
  clock = createUtcClock(() => new Date().toISOString())
}: {
  connection: Database.Database
  authenticationSessionService: LocalAuthenticationSessionService
  credentialProtector: SyncCredentialProtector
  httpClient?: HistoryHttpClient
  clock?: UtcClock
}): CentralHistoryService {
  const repository = createCentralHistoryRepository(connection)
  const auditRepository = createAuditEventRepository(connection)
  const transaction = createDatabaseTransactionExecutor({
    connection,
    clock,
    idGenerator: createEntityIdGenerator(randomUUID)
  })
  const transport = createSyncTransportFoundationService({
    repository: createSyncTransportBatchRepository(connection),
    transactionExecutor: transaction,
    credentialProtector
  })
  const inFlight = new Set<string>()
  let blockedCacheReads = false

  function invalidateCachedAccess(): void {
    // Revocation is committed separately: an audit failure must never restore
    // access through rollback. A storage failure also blocks in-process reads.
    blockedCacheReads = true
    try {
      transaction.run((tx) => repository.invalidateAccess(tx.connection))
      blockedCacheReads = false
    } catch {
      /* Fail closed until the cache can be invalidated. */
    }
  }

  function access(patientId: string): AccessContext {
    let session: ReturnType<LocalAuthenticationSessionService['requireAnyRole']>
    try {
      session = auth.requireAnyRole(['LOCAL_ADMIN', 'NURSE'])
    } catch {
      const state = auth.getSnapshot()
      throw new HistoryFailure(state.status === 'ACTIVE' ? 'FORBIDDEN' : 'UNAUTHENTICATED')
    }
    const identity = repository.identity(patientId, session.user.id)
    if (!identity || identity.patient_revision !== identity.accepted_revision)
      throw new HistoryFailure('IDENTITY_NOT_READY')
    if (
      !identity.user_active ||
      identity.user_password_change ||
      !['LOCAL_ADMIN', 'NURSE'].includes(identity.user_role) ||
      identity.user_role !== session.user.role
    )
      throw new HistoryFailure('FORBIDDEN')
    const configuration = transport.getConfigurationState()
    const credential = transport.loadCredentialForTransport()
    if (configuration.status !== 'CONFIGURED' || !credential)
      throw new HistoryFailure('NOT_CONFIGURED')
    const binding = createHash('sha256')
      .update(
        JSON.stringify({
          identity,
          userId: session.user.id,
          origin: credential.apiBaseUrl,
          credential: credential.installationToken,
          configuredAt: configuration.updatedAt
        })
      )
      .digest('hex')
    return {
      patientId,
      userId: session.user.id,
      installationId: identity.installation_id,
      personId: identity.person_id,
      chsMedicalId: identity.chs_medical_id,
      binding,
      authenticatedAt: session.authenticatedAt,
      credential
    }
  }

  function recheck(context: AccessContext): void {
    const current = access(context.patientId)
    if (current.userId !== context.userId || current.authenticatedAt !== context.authenticatedAt)
      throw new HistoryFailure('UNAUTHENTICATED')
    if (current.binding !== context.binding) throw new HistoryFailure('ACCESS_DENIED')
  }
  function audit(
    tx: DatabaseTransactionContext,
    context: AccessContext,
    action: string,
    metadata: { reasonCode: string; outcome: string; itemCount?: number }
  ): void {
    auditRepository.insert(tx.connection, {
      id: tx.newEntityId(),
      installationId: parseEntityId(context.installationId),
      userId: parseEntityId(context.userId),
      action: parseAuditActionCode(action),
      entityType: parseAuditEntityType('PATIENT'),
      entityId: parseEntityId(context.patientId),
      occurredAt: tx.nowUtc(),
      metadata: {
        reason_code: metadata.reasonCode,
        outcome: metadata.outcome,
        ...(metadata.itemCount === undefined ? {} : { item_count: metadata.itemCount })
      }
    })
  }

  function read(request: unknown): CentralHistoryReadData {
    try {
      const parsed = centralHistoryReadRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      const input = parsed.data
      const context = access(input.patientId)
      if (blockedCacheReads) return { status: 'ACCESS_DENIED' }
      return transaction.run((tx) => {
        const snapshot = repository.snapshot(input.patientId, context.userId, 'READY')
        if (
          !snapshot ||
          snapshot.binding_key !== context.binding ||
          Date.parse(snapshot.updated_at) < Date.parse(clock.now()) - 30 * 86400000
        ) {
          audit(tx, context, 'CENTRAL_HISTORY_READ', {
            reasonCode: input.reasonCode,
            outcome: 'NO_CACHE'
          })
          return { status: 'NO_CACHE' } as const
        }
        if (input.snapshotId && input.snapshotId !== snapshot.id)
          return { status: 'CACHE_CHANGED' } as const
        if (input.offset > 0 && !input.snapshotId) return { status: 'VALIDATION_FAILED' } as const
        const total = repository.count(snapshot.id, input.resourceType)
        if (input.offset > total) return { status: 'VALIDATION_FAILED' } as const
        const page: HistoryPage = {
          contractVersion: '1.0',
          personId: context.personId,
          patient: JSON.parse(snapshot.patient_json ?? 'null'),
          retrievedAt: snapshot.retrieved_at ?? '',
          fromDate: snapshot.from_date,
          toDate: snapshot.to_date,
          nextCursor: null,
          items: []
        }
        const items: HistoryItem[] = []
        let bytes = Buffer.byteLength(JSON.stringify(page), 'utf8')
        for (const row of repository.rows(snapshot.id, input.offset, input.resourceType)) {
          bytes += Buffer.byteLength(row.item_json, 'utf8') + 1
          if (bytes > historyPageByteLimit && items.length > 0) break
          if (bytes > historyPageByteLimit) throw new HistoryFailure('INVALID_RESPONSE')
          items.push(JSON.parse(row.item_json) as HistoryItem)
        }
        const resultPage = { ...page, items }
        if (!isHistoryPage(resultPage) || resultPage.patient.chsMedicalId !== context.chsMedicalId)
          throw new HistoryFailure('INVALID_RESPONSE')
        audit(tx, context, 'CENTRAL_HISTORY_READ', {
          reasonCode: input.reasonCode,
          outcome: 'READY',
          itemCount: items.length
        })
        return {
          status: 'READY',
          snapshotId: snapshot.id,
          savedAt: snapshot.updated_at,
          page: resultPage,
          offset: input.offset,
          total,
          nextOffset: input.offset + items.length < total ? input.offset + items.length : null
        } as const
      })
    } catch (error) {
      return failure(error)
    }
  }

  async function refresh(request: unknown): Promise<CentralHistoryRefreshData> {
    let key: string | undefined
    try {
      const parsed = centralHistoryRefreshRequestSchema.safeParse(request)
      if (!parsed.success) return { status: 'VALIDATION_FAILED' }
      const input = parsed.data
      const context = access(input.patientId)
      if (blockedCacheReads) {
        invalidateCachedAccess()
        if (blockedCacheReads) return { status: 'ACCESS_DENIED' }
      }
      key = `${input.patientId}:${context.userId}`
      if (inFlight.has(key)) {
        key = undefined
        return { status: 'BUSY' }
      }
      inFlight.add(key)
      let snapshot = repository.snapshot(input.patientId, context.userId, 'DOWNLOADING')
      if (
        input.restart ||
        !snapshot ||
        snapshot.binding_key !== context.binding ||
        snapshot.reason_code !== input.reasonCode ||
        snapshot.from_date !== input.fromDate ||
        snapshot.to_date !== input.toDate ||
        Date.parse(snapshot.created_at) < Date.parse(clock.now()) - 14 * 60000
      ) {
        snapshot = transaction.run((tx) => {
          repository.remove(tx.connection, input.patientId, context.userId, 'DOWNLOADING')
          const value: HistorySnapshot = {
            id: tx.newEntityId(),
            patient_id: input.patientId,
            owner_user_id: context.userId,
            binding_key: context.binding,
            state: 'DOWNLOADING',
            reason_code: input.reasonCode,
            from_date: input.fromDate,
            to_date: input.toDate,
            retrieved_at: null,
            patient_json: null,
            next_cursor: null,
            page_count: 0,
            item_count: 0,
            byte_count: 0,
            created_at: tx.nowUtc(),
            updated_at: tx.nowUtc()
          }
          repository.start(tx.connection, value)
          audit(tx, context, 'CENTRAL_HISTORY_REFRESH', {
            reasonCode: input.reasonCode,
            outcome: 'STARTED'
          })
          return value
        })
      }
      const response = await httpClient(context.credential, {
        contractVersion: '1.0',
        personId: context.personId,
        localPatientId: input.patientId,
        requesterLocalActorId: context.userId,
        reasonCode: input.reasonCode,
        fromDate: input.fromDate,
        toDate: input.toDate,
        limit: 50,
        ...(snapshot.next_cursor ? { cursor: snapshot.next_cursor } : {})
      })
      if (response.status === 'ACCESS_DENIED') {
        // A denial still invalidates saved access if the caller locked or signed
        // out while waiting. No clinical data is disclosed by this operation.
        invalidateCachedAccess()
        try {
          transaction.run((tx) =>
            audit(tx, context, 'CENTRAL_HISTORY_REFRESH', {
              reasonCode: input.reasonCode,
              outcome: 'ACCESS_DENIED'
            })
          )
        } catch {
          /* Keep the explicit denial even when its audit cannot be saved. */
        }
        return { status: 'ACCESS_DENIED' }
      }
      recheck(context)
      if (response.status !== 'RECEIVED') {
        transaction.run((tx) => {
          if (['CURSOR_STALE', 'INVALID_RESPONSE'].includes(response.status))
            repository.remove(tx.connection, input.patientId, context.userId, 'DOWNLOADING')
          audit(tx, context, 'CENTRAL_HISTORY_REFRESH', {
            reasonCode: input.reasonCode,
            outcome: response.status
          })
        })
        return response
      }
      const page = response.page
      const bytes = Buffer.byteLength(JSON.stringify(page), 'utf8')
      let rejected: CentralHistoryStatus | undefined
      if (
        !isHistoryPage(page) ||
        bytes > historyPageByteLimit ||
        page.personId !== context.personId ||
        page.patient.chsMedicalId !== context.chsMedicalId ||
        page.fromDate !== input.fromDate ||
        page.toDate !== input.toDate ||
        (page.nextCursor !== null &&
          (page.items.length === 0 || page.nextCursor === snapshot.next_cursor)) ||
        (snapshot.page_count > 0 &&
          (page.retrievedAt !== snapshot.retrieved_at ||
            JSON.stringify(page.patient) !== snapshot.patient_json))
      ) {
        rejected = 'INVALID_RESPONSE'
      }
      let previous = repository.lastItem(snapshot.id)
      for (const item of page.items) {
        if (
          Date.parse(item.occurredAt) < Date.parse(input.fromDate) ||
          Date.parse(item.occurredAt) >= Date.parse(input.toDate) + 86400000 ||
          (previous && !comesAfter(previous, item)) ||
          repository.contains(snapshot.id, item)
        )
          rejected = 'INVALID_RESPONSE'
        previous = item
      }
      if (
        snapshot.item_count + page.items.length > 5000 ||
        snapshot.byte_count + bytes > 16 * 1024 * 1024 ||
        snapshot.page_count >= 200 ||
        (snapshot.page_count === 199 && page.nextCursor !== null)
      )
        rejected = 'LIMIT_REACHED'
      if (rejected) {
        transaction.run((tx) => {
          repository.remove(tx.connection, input.patientId, context.userId, 'DOWNLOADING')
          audit(tx, context, 'CENTRAL_HISTORY_REFRESH', {
            reasonCode: input.reasonCode,
            outcome: rejected
          })
        })
        return { status: rejected }
      }
      transaction.run((tx) => {
        repository.append(tx.connection, snapshot, page, bytes, tx.nowUtc())
        audit(tx, context, 'CENTRAL_HISTORY_REFRESH', {
          reasonCode: input.reasonCode,
          outcome: page.nextCursor === null ? 'COMPLETE' : 'PAGE_SAVED',
          itemCount: page.items.length
        })
      })
      return {
        status: page.nextCursor === null ? 'COMPLETE' : 'IN_PROGRESS',
        downloaded: snapshot.item_count + page.items.length
      }
    } catch (error) {
      return failure(error)
    } finally {
      if (key) inFlight.delete(key)
    }
  }
  return { read, refresh }
}

function failure(error: unknown): { status: CentralHistoryStatus } {
  return { status: error instanceof HistoryFailure ? error.status : 'UNAVAILABLE' }
}

// Same descending timestamp/type/id order as the server keyset cursor.
function comesAfter(previous: HistoryItem, item: HistoryItem): boolean {
  const difference = Date.parse(previous.occurredAt) - Date.parse(item.occurredAt)
  if (difference !== 0) return difference > 0
  if (previous.resourceType !== item.resourceType) return previous.resourceType > item.resourceType
  return previous.resourceId > item.resourceId
}
