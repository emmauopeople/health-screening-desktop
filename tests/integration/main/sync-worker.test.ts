import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createSyncSnapshotPreparationService,
  createSyncTransportFoundationService,
  createSyncWorkerService,
  type SyncCredentialProtector,
  type SyncHttpClient,
  type SyncHttpResult,
  type SyncSnapshotPreparationService,
  type SyncTransportFoundationService,
  type SyncWorkerService
} from '@main/application/sync-transport'
import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createSyncSnapshotRepository,
  createSyncTransportBatchRepository,
  createSyncWorkerRepository,
  type DatabaseTransactionExecutor
} from '@main/database'
import { createEntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'
import {
  createSyncWorkerMonitor,
  type SyncWorkerMonitor
} from '@main/application/sync-transport/sync-worker-monitor'

const at = parseUtcTimestamp('2026-09-03T12:00:00.000Z')
const actorId = '10000000-0000-4000-8000-000000000001'
const installationId = '20000000-0000-4000-8000-000000000001'
const locationId = '30000000-0000-4000-8000-000000000001'
const patientId = '40000000-0000-4000-8000-000000000001'
const sessionId = '50000000-0000-4000-8000-000000000001'
const encounterId = '60000000-0000-4000-8000-000000000001'
const vitalsId = '70000000-0000-4000-8000-000000000001'
const lifestyleId = '80000000-0000-4000-8000-000000000001'
const token = `chs_inst_v1_${'A'.repeat(43)}`

const patientOutboxOne = '90000000-0000-4000-8000-000000000001'
const patientOutboxTwo = '90000000-0000-4000-8000-000000000002'
const sessionOutbox = '90000000-0000-4000-8000-000000000003'
const encounterOutboxOne = '90000000-0000-4000-8000-000000000004'
const encounterOutboxTwo = '90000000-0000-4000-8000-000000000005'
const vitalsOutbox = '90000000-0000-4000-8000-000000000006'
const lifestyleOutbox = '90000000-0000-4000-8000-000000000007'
const excludedOutbox = '90000000-0000-4000-8000-000000000008'

describe('HSW-013B desktop synchronization worker', () => {
  it('maps annotation outcomes independently and keeps a late closure pending until its own batch', async () => {
    const h = createHarness(Array.from({ length: 40 }, () => randomUUID()))
    try {
      const c = h.connection
      seedCompleteGraph(c)
      configure(h.foundation)
      const note = randomUUID(),
        flag = randomUUID()
      c.prepare('INSERT INTO screening_encounter_addenda VALUES (?,?,?,?,?)').run(
        note,
        encounterId,
        'Synthetic late note',
        actorId,
        at
      )
      c.prepare(
        "INSERT INTO screening_encounter_review_flags VALUES (?,?,'OTHER','Synthetic review','OPEN',?,?,NULL,NULL,NULL)"
      ).run(flag, encounterId, actorId, at)
      const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) => {
        if (submitBatch.mock.calls.length === 1)
          c.prepare(
            "UPDATE screening_encounter_review_flags SET status='RESOLVED',resolved_by=?,resolved_at=?,resolution_note='Reviewed' WHERE id=?"
          ).run(actorId, at, flag)
        return response(200, acceptedResponse(requestJson))
      })
      const worker = createWorker(h, httpClient({ submitBatch }))
      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      expect(
        c
          .prepare(
            "SELECT resource_type FROM sync_transport_resource_mappings WHERE resource_type LIKE 'ENCOUNTER_%' ORDER BY resource_type"
          )
          .all()
      ).toEqual([
        { resource_type: 'ENCOUNTER_ADDENDUM' },
        { resource_type: 'ENCOUNTER_REVIEW_FLAG' },
        { resource_type: 'ENCOUNTER_REVIEW_STATUS' }
      ])
      expect(
        c
          .prepare(
            "SELECT status,count(*) AS n FROM sync_outbox WHERE aggregate_type='ENCOUNTER_HISTORY' GROUP BY status ORDER BY status"
          )
          .all()
      ).toEqual([
        { status: 'PENDING', n: 1 },
        { status: 'SENT', n: 3 }
      ])
      expect(await createWorker(h, httpClient({ submitBatch })).runOnce()).toMatchObject({
        status: 'SYNCED'
      })
      expect(
        c
          .prepare(
            "SELECT count(*) AS n FROM sync_transport_resource_mappings WHERE resource_type='ENCOUNTER_REVIEW_STATUS'"
          )
          .get()
      ).toEqual({ n: 2 })
      expect(
        c
          .prepare(
            "SELECT status,count(*) AS n FROM sync_outbox WHERE aggregate_type='ENCOUNTER_HISTORY' GROUP BY status"
          )
          .all()
      ).toEqual([{ status: 'SENT', n: 4 }])
    } finally {
      h.connection.close()
    }
  })

  it('maps separate referral outcomes without retiring a follow-up queued during delivery', async () => {
    const harness = createHarness(Array.from({ length: 30 }, () => randomUUID()))
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      const referralId = randomUUID()
      const historyId = randomUUID()
      const followupId = randomUUID()
      const referralSignal = randomUUID()
      const historySignal = randomUUID()
      const followupSignal = randomUUID()
      const laterSignal = randomUUID()
      seedReferralSyncGraph(harness.connection, referralId, historyId, followupId)
      insertOutbox(
        harness.connection,
        referralSignal,
        'REFERRAL',
        referralId,
        'REFERRAL_CREATED',
        at
      )
      insertOutbox(
        harness.connection,
        historySignal,
        'REFERRAL_HISTORY',
        historyId,
        'REFERRAL_STATUS_HISTORY_RECORDED',
        at
      )
      insertOutbox(
        harness.connection,
        followupSignal,
        'REFERRAL_HISTORY',
        followupId,
        'REFERRAL_FOLLOWUP_SYNC_REQUESTED',
        at
      )
      const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) => {
        insertOutbox(
          harness.connection,
          laterSignal,
          'REFERRAL_HISTORY',
          randomUUID(),
          'REFERRAL_FOLLOWUP_SYNC_REQUESTED',
          at
        )
        return response(200, acceptedResponse(requestJson))
      })
      const worker = createWorker(harness, httpClient({ submitBatch }))

      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      expect(
        harness.connection
          .prepare(
            `SELECT resource_type FROM sync_transport_resource_mappings
             WHERE resource_type LIKE 'REFERRAL%' ORDER BY resource_type`
          )
          .all()
      ).toEqual([
        { resource_type: 'REFERRAL' },
        { resource_type: 'REFERRAL_FOLLOWUP' },
        { resource_type: 'REFERRAL_STATUS' }
      ])
      expect(
        harness.connection.prepare('SELECT status FROM sync_outbox WHERE id = ?').get(laterSignal)
      ).toEqual({ status: 'PENDING' })
      expect(
        harness.connection
          .prepare(
            `SELECT id, status FROM sync_outbox
             WHERE id IN (?, ?, ?) ORDER BY id`
          )
          .all(referralSignal, historySignal, followupSignal)
      ).toEqual(
        [referralSignal, historySignal, followupSignal].sort().map((id) => ({ id, status: 'SENT' }))
      )
    } finally {
      harness.connection.close()
    }
  })

  it.each(['ACCEPTED', 'REJECTED', 'RETRY'])(
    'reconciles orphaned signals using the saved %s outcome without replaying a completed batch',
    async (status) => {
      const harness = createHarness(Array.from({ length: 12 }, () => randomUUID()))
      try {
        seedCompleteGraph(harness.connection)
        configure(harness.foundation)
        const draftSignal = randomUUID()
        insertOutbox(
          harness.connection,
          draftSignal,
          'SCREENING_ENCOUNTER',
          encounterId,
          'SCREENING_VITALS_DRAFT_SAVED',
          at
        )
        const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) => {
          const body = JSON.parse(acceptedResponse(requestJson))
          const vital = body.outcomes.find(
            (outcome: { resourceType: string }) => outcome.resourceType === 'VITALS'
          )
          vital.status = status
          if (status !== 'ACCEPTED') {
            vital.canonicalResourceId = null
            vital.errors = [
              {
                code:
                  status === 'RETRY' ? 'DEPENDENCY_NOT_AVAILABLE' : 'MEASUREMENT_PERIOD_INVALID',
                path: '',
                retryable: status === 'RETRY'
              }
            ]
            body.batchStatus = 'PARTIAL'
          }
          return response(200, JSON.stringify(body))
        })
        const worker = createWorker(harness, httpClient({ submitBatch }))
        expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
        const history = harness.connection.prepare('SELECT * FROM sync_transport_batches').all()
        const clinical = harness.connection.prepare('SELECT * FROM screening_vitals_drafts').all()
        // Reproduce the old worker: it applied the step outcome but left its
        // coalesced draft signal in flight even though the batch completed.
        harness.connection
          .prepare(
            "UPDATE sync_outbox SET status = 'IN_FLIGHT', sent_at = NULL, next_attempt_at = NULL, last_error_code = NULL, attempt_count = 0 WHERE id = ?"
          )
          .run(draftSignal)
        expect(await createWorker(harness, httpClient({ submitBatch })).runOnce()).toMatchObject({
          status: 'IDLE'
        })
        expect(
          harness.connection
            .prepare('SELECT status, attempt_count, last_error_code FROM sync_outbox WHERE id = ?')
            .get(draftSignal)
        ).toEqual({
          status: status === 'RETRY' ? 'FAILED' : 'SENT',
          attempt_count: 1,
          last_error_code:
            status === 'RETRY'
              ? 'DEPENDENCY_NOT_AVAILABLE'
              : status === 'REJECTED'
                ? 'MEASUREMENT_PERIOD_INVALID'
                : null
        })
        expect(await worker.runOnce()).toMatchObject({ status: 'IDLE' })
        expect(
          harness.connection
            .prepare('SELECT attempt_count FROM sync_outbox WHERE id = ?')
            .get(draftSignal)
        ).toEqual({ attempt_count: 1 })
        expect(submitBatch).toHaveBeenCalledOnce()
        expect(harness.connection.prepare('SELECT * FROM sync_transport_batches').all()).toEqual(
          history
        )
        expect(harness.connection.prepare('SELECT * FROM screening_vitals_drafts').all()).toEqual(
          clinical
        )
        expect(
          harness.connection
            .prepare('SELECT status FROM sync_outbox WHERE id = ?')
            .get(excludedOutbox)
        ).toEqual({ status: 'PENDING' })
      } finally {
        harness.connection.close()
      }
    }
  )

  it('does not reconcile a signal reserved by another unfinished batch', async () => {
    const harness = createHarness(Array.from({ length: 8 }, () => randomUUID()))
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      const draftSignal = randomUUID()
      insertOutbox(
        harness.connection,
        draftSignal,
        'SCREENING_ENCOUNTER',
        encounterId,
        'SCREENING_VITALS_DRAFT_SAVED',
        at
      )
      expect(
        await createWorker(
          harness,
          httpClient({
            submitBatch: async (_credential, requestJson) =>
              response(200, acceptedResponse(requestJson))
          })
        ).runOnce()
      ).toMatchObject({ status: 'SYNCED' })
      const original = harness.connection
        .prepare('SELECT request_json FROM sync_transport_batches')
        .get() as { request_json: string }
      const request = JSON.parse(original.request_json)
      request.batchId = randomUUID()
      request.records = request.records.filter(
        (record: { resourceType: string }) => record.resourceType === 'VITALS'
      )
      const requestJson = JSON.stringify(request)
      harness.connection
        .prepare("UPDATE sync_outbox SET status = 'IN_FLIGHT', sent_at = NULL WHERE id = ?")
        .run(draftSignal)
      harness.connection
        .prepare(
          "INSERT INTO sync_transport_batches (id, request_json, request_sha256, status, created_at) VALUES (?, ?, ?, 'PREPARED', ?)"
        )
        .run(
          request.batchId,
          requestJson,
          createHash('sha256').update(requestJson).digest('hex'),
          at
        )
      harness.connection
        .prepare(
          'INSERT INTO sync_transport_batch_items (batch_id, outbox_id, sequence_number) VALUES (?, ?, 1)'
        )
        .run(request.batchId, draftSignal)
      harness.transactionExecutor.run((context) =>
        createSyncWorkerRepository(harness.connection).reconcileCompletedSignals(
          context.connection,
          at
        )
      )
      expect(
        harness.connection.prepare('SELECT status FROM sync_outbox WHERE id = ?').get(draftSignal)
      ).toEqual({ status: 'IN_FLIGHT' })
    } finally {
      harness.connection.close()
    }
  })

  it.each([
    [vitalsOutbox, 'SCREENING_VITALS_DRAFT_SAVED'],
    [lifestyleOutbox, 'SCREENING_LIFESTYLE_DRAFT_SAVED'],
    [lifestyleOutbox, 'SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED'],
    [lifestyleOutbox, 'SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED'],
    [lifestyleOutbox, 'SCREENING_LIFESTYLE_WORK_BASELINE_CREATED'],
    [lifestyleOutbox, 'SCREENING_LIFESTYLE_REOPENED']
  ])('commits a response for a batch prepared from %s / %s', async (signalId, operation) => {
    const harness = createHarness(Array.from({ length: 8 }, () => randomUUID()))
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      harness.connection
        .prepare('UPDATE sync_outbox SET operation = ? WHERE id = ?')
        .run(operation, signalId)
      const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) =>
        response(200, acceptedResponse(requestJson))
      )
      expect(await createWorker(harness, httpClient({ submitBatch })).runOnce()).toMatchObject({
        status: 'SYNCED'
      })
      expect(submitBatch).toHaveBeenCalledOnce()
      expect(readStatuses(harness.connection)).toEqual([...Array(7).fill('SENT'), 'PENDING'])
      expect(harness.connection.prepare('SELECT status FROM sync_transport_batches').get()).toEqual(
        { status: 'COMPLETED' }
      )
    } finally {
      harness.connection.close()
    }
  })

  it('applies each outcome to all its reserved signals while retaining retrying and unbatched work', async () => {
    const harness = createHarness(Array.from({ length: 8 }, () => randomUUID()))
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      const vitalsDraft = randomUUID()
      const lifestyleDraft = randomUUID()
      const lateSignal = randomUUID()
      insertOutbox(
        harness.connection,
        vitalsDraft,
        'SCREENING_ENCOUNTER',
        encounterId,
        'SCREENING_VITALS_DRAFT_SAVED',
        at
      )
      insertOutbox(
        harness.connection,
        lifestyleDraft,
        'SCREENING_ENCOUNTER',
        encounterId,
        'SCREENING_LIFESTYLE_DRAFT_SAVED',
        at
      )
      const worker = createWorker(
        harness,
        httpClient({
          submitBatch: async (_credential, requestJson) => {
            // A newer event created while HTTP is in progress is outside this batch.
            insertOutbox(
              harness.connection,
              lateSignal,
              'SCREENING_ENCOUNTER',
              encounterId,
              'SCREENING_LIFESTYLE_DRAFT_SAVED',
              at
            )
            const body = JSON.parse(acceptedResponse(requestJson))
            const vital = body.outcomes.find(
              (outcome: { resourceType: string }) => outcome.resourceType === 'VITALS'
            )
            vital.status = 'RETRY'
            vital.canonicalResourceId = null
            vital.errors = [
              {
                code: 'DEPENDENCY_NOT_AVAILABLE',
                path: '/payload/localEncounterId',
                retryable: true
              }
            ]
            body.batchStatus = 'PARTIAL'
            return response(200, JSON.stringify(body))
          }
        })
      )
      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      for (const id of [vitalsOutbox, vitalsDraft]) {
        expect(
          harness.connection
            .prepare('SELECT status, last_error_code FROM sync_outbox WHERE id = ?')
            .get(id)
        ).toEqual({ status: 'FAILED', last_error_code: 'DEPENDENCY_NOT_AVAILABLE' })
      }
      for (const id of [lifestyleOutbox, lifestyleDraft]) {
        expect(
          harness.connection.prepare('SELECT status FROM sync_outbox WHERE id = ?').get(id)
        ).toEqual({ status: 'SENT' })
      }
      for (const id of [lateSignal, excludedOutbox]) {
        expect(
          harness.connection.prepare('SELECT status FROM sync_outbox WHERE id = ?').get(id)
        ).toEqual({ status: 'PENDING' })
      }
      expect(
        harness.connection
          .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'IN_FLIGHT'")
          .get()
      ).toEqual({ count: 0 })
    } finally {
      harness.connection.close()
    }
  })

  it('recovers an existing in-flight draft-signal batch by GET without a new upload', async () => {
    const harness = createHarness(Array.from({ length: 8 }, () => randomUUID()))
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      harness.connection
        .prepare("UPDATE sync_outbox SET operation = 'SCREENING_VITALS_DRAFT_SAVED' WHERE id = ?")
        .run(vitalsOutbox)
      harness.connection
        .prepare(
          "UPDATE sync_outbox SET operation = 'SCREENING_LIFESTYLE_DRAFT_SAVED' WHERE id = ?"
        )
        .run(lifestyleOutbox)
      expect(createPreparation(harness).prepareNextBatch()).toMatchObject({ status: 'PREPARED' })
      const claimed = harness.foundation.claimNextBatch(1000)
      expect(claimed.status).toBe('CLAIMED')
      if (claimed.status !== 'CLAIMED') throw new Error('Expected a claimed batch')
      const savedRequest = claimed.requestJson
      const centralResponse = acceptedResponse(savedRequest)
      harness.now.value = parseUtcTimestamp('2026-09-03T12:05:00.000Z')
      const recoverBatch = vi.fn(async () => response(200, centralResponse))
      const submitBatch = vi.fn(async () => response(503, problem(503, 'UNAVAILABLE')))
      const restarted = createWorker(harness, httpClient({ recoverBatch, submitBatch }))
      // Expired leases first become eligible after the normal recovery delay.
      expect(await restarted.runOnce()).toMatchObject({ status: 'IDLE' })
      harness.now.value = parseUtcTimestamp('2026-09-03T12:10:00.000Z')
      expect(await restarted.runOnce()).toMatchObject({ status: 'SYNCED' })
      expect(recoverBatch).toHaveBeenCalledOnce()
      expect(submitBatch).not.toHaveBeenCalled()
      expect(
        harness.connection
          .prepare('SELECT request_json, response_json, status FROM sync_transport_batches')
          .all()
      ).toEqual([
        { request_json: savedRequest, response_json: centralResponse, status: 'COMPLETED' }
      ])
      expect(readStatuses(harness.connection)).toEqual([...Array(7).fill('SENT'), 'PENDING'])
    } finally {
      harness.connection.close()
    }
  })

  it('reports a preparation failure before any HTTP attempt and recovers on the next run', async () => {
    const harness = createHarness([])
    try {
      seedCompleteGraph(harness.connection)
      configure(harness.foundation)
      harness.connection.prepare("UPDATE patients SET sex = 'INVALID'").run()
      const submitBatch = vi.fn(async () => response(503, problem(503, 'UNAVAILABLE')))
      const monitor = createSyncWorkerMonitor(() => at)
      const worker = createWorker(harness, httpClient({ submitBatch }), monitor)

      expect(await worker.runOnce()).toEqual({ status: 'UNAVAILABLE' })
      expect(monitor.getLatest()).toEqual({
        checkedAt: at,
        status: 'UNAVAILABLE',
        phase: 'SNAPSHOT',
        diagnostic: { stage: 'PATIENT', rule: 'INVALID_VALUE', field: 'sex' }
      })
      expect(submitBatch).not.toHaveBeenCalled()
      expect(
        harness.connection.prepare('SELECT COUNT(*) AS count FROM sync_transport_batches').get()
      ).toEqual({ count: 0 })
      expect(readStatuses(harness.connection)).toEqual(Array(8).fill('PENDING'))

      harness.connection.prepare("UPDATE patients SET sex = 'UNKNOWN'").run()
      expect(await worker.runOnce()).toMatchObject({ status: 'RETRY_SCHEDULED' })
      expect(submitBatch).toHaveBeenCalledOnce()
      expect(monitor.getLatest()).toEqual({
        checkedAt: at,
        status: 'RETRY_SCHEDULED',
        phase: 'UPLOAD'
      })
      expect(JSON.stringify(monitor.getLatest())).not.toContain(token)
    } finally {
      harness.connection.close()
    }
  })

  it('reports credential loading failure without exposing exceptions or stopping later runs', async () => {
    const harness = createHarness([])
    try {
      const monitor = createSyncWorkerMonitor(() => at)
      const worker = createWorker(harness, httpClient({}), monitor)
      expect(await worker.runOnce()).toEqual({ status: 'NOT_CONFIGURED' })
      expect(monitor.getLatest()).toEqual({
        checkedAt: at,
        status: 'NOT_CONFIGURED',
        phase: 'CREDENTIAL'
      })
      const failingHarness = {
        ...harness,
        foundation: {
          ...harness.foundation,
          loadCredentialForTransport: () => {
            throw new Error(`secret ${token}`)
          }
        }
      }
      expect(await createWorker(failingHarness, httpClient({}), monitor).runOnce()).toEqual({
        status: 'UNAVAILABLE'
      })
      expect(monitor.getLatest()).toEqual({
        checkedAt: at,
        status: 'UNAVAILABLE',
        phase: 'CREDENTIAL'
      })
      expect(JSON.stringify(monitor.getLatest())).not.toContain(token)
      const brokenObserver = {
        ...monitor,
        record: () => {
          throw new Error('monitor failed')
        }
      }
      expect(await createWorker(harness, httpClient({}), brokenObserver).runOnce()).toEqual({
        status: 'NOT_CONFIGURED'
      })
    } finally {
      harness.connection.close()
    }
  })

  it('coalesces audit signals into dependency-ordered full snapshots without deferred resources', () => {
    const harness = createHarness(['01000000-0000-4000-8000-000000000001'])
    seedCompleteGraph(harness.connection)

    expect(createPreparation(harness).prepareNextBatch()).toMatchObject({ status: 'PREPARED' })
    const stored = harness.connection
      .prepare('SELECT request_json FROM sync_transport_batches')
      .get() as { request_json: string }
    const work = JSON.parse(stored.request_json) as {
      installationId: string
      locationId: string
      installationTimezone: string
      actors: readonly Record<string, unknown>[]
      records: readonly {
        recordId: string
        resourceType: string
        localResourceId: string
        payload: Record<string, unknown>
      }[]
    }

    expect(work.installationId).toBe(installationId)
    expect(work.locationId).toBe(locationId)
    expect(work.installationTimezone).toBe('Africa/Douala')
    expect(work.records.map((record) => record.resourceType)).toEqual([
      'PATIENT',
      'SCREENING_SESSION',
      'SCREENING_ENCOUNTER',
      'VITALS',
      'LIFESTYLE'
    ])
    expect(work.records.map((record) => record.recordId)).toEqual([
      patientOutboxTwo,
      sessionOutbox,
      encounterOutboxTwo,
      vitalsOutbox,
      lifestyleOutbox
    ])
    expect(readStatuses(harness.connection)).toEqual([
      ...Array.from({ length: 7 }, () => 'IN_FLIGHT'),
      'PENDING'
    ])
    expect(work.actors).toEqual([
      {
        localActorId: actorId,
        displayName: 'Synthetic Nurse',
        role: 'NURSE',
        active: true,
        updatedAt: at
      }
    ])

    const patient = work.records[0]
    expect(patient?.payload).toMatchObject({
      localPatientCode: 'PT-000001',
      acknowledgmentStatus: 'ACKNOWLEDGED',
      knownChsMedicalId: null,
      dateOfBirth: '1980-01-01'
    })
    const vitals = work.records[3]
    expect(vitals?.localResourceId).toBe(vitalsId)
    expect(vitals?.payload).toMatchObject({
      localEncounterId: encounterId,
      performedByLocalActorId: actorId,
      status: 'VITALS_COMPLETE',
      readings: [
        {
          sequenceNumber: 1,
          systolic: 128,
          diastolic: 82,
          measurementLocalDate: '2026-09-03',
          measurementLocalTime: '12:30',
          measurementTimezone: 'Africa/Douala'
        }
      ]
    })
    expect(work.records[4]?.payload).toMatchObject({
      status: 'COMPLETE',
      periodStart: '2026-08-28',
      periodEnd: '2026-09-03',
      otherActivity: { weeklyResponse: 'NO', activities: [] }
    })
    expect(JSON.stringify(work)).not.toContain('password')
    harness.connection.close()
  })

  it('applies Food/OTC independently and clears superseded drafts only after acceptance', async () => {
    const harness = createHarness([
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000003'
    ])
    seedCompleteGraph(harness.connection)
    const foodSignal = 'e1000000-0000-4000-8000-000000000001'
    const otcSignal = 'e1000000-0000-4000-8000-000000000002'
    const foodDraftSignal = 'e1000000-0000-4000-8000-000000000003'
    const otcDraftSignal = 'e1000000-0000-4000-8000-000000000004'
    for (const [id, operation] of [
      [foodSignal, 'SCREENING_FOOD_FINALIZED'],
      [otcSignal, 'SCREENING_OTC_FINALIZED'],
      [foodDraftSignal, 'SCREENING_FOOD_DRAFT_SAVED'],
      [otcDraftSignal, 'SCREENING_OTC_DRAFT_SAVED']
    ]) {
      insertOutbox(harness.connection, id!, 'SCREENING_ENCOUNTER', encounterId, operation!, at)
    }
    configure(harness.foundation)
    const worker = createWorker(
      harness,
      httpClient({
        submitBatch: async (_credential, requestJson) => {
          const responseBody = JSON.parse(acceptedResponse(requestJson))
          responseBody.batchStatus = 'PARTIAL'
          const otc = responseBody.outcomes.find(
            (o: { resourceType: string }) => o.resourceType === 'OTC'
          )
          otc.status = 'RETRY'
          otc.canonicalResourceId = null
          otc.errors = [{ code: 'DEPENDENCY_NOT_AVAILABLE', path: '', retryable: true }]
          return response(200, JSON.stringify(responseBody))
        }
      })
    )
    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'SYNCED', recordCount: 7 })
    const status = (id: string): string =>
      (
        harness.connection.prepare('SELECT status FROM sync_outbox WHERE id = ?').get(id) as {
          status: string
        }
      ).status
    expect(status(foodSignal)).toBe('SENT')
    expect(status(foodDraftSignal)).toBe('SENT')
    expect(status(otcSignal)).toBe('FAILED')
    expect(status(otcDraftSignal)).toBe('PENDING')
    // The existing fixture's excluded signal is also a Food draft notification.
    expect(status(excludedOutbox)).toBe('SENT')
    expect(
      harness.connection
        .prepare(
          "SELECT resource_type FROM sync_transport_resource_mappings WHERE resource_type IN ('FOOD','OTC')"
        )
        .all()
    ).toEqual([{ resource_type: 'FOOD' }])
    harness.connection.close()
  })

  it('stores an immutable response, terminal outcomes, and canonical mappings atomically', async () => {
    const harness = createHarness([
      'a0000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000003'
    ])
    seedCompleteGraph(harness.connection)
    configure(harness.foundation)
    let submittedRequest = ''
    const http = httpClient({
      submitBatch: async (_credential, requestJson) => {
        submittedRequest = requestJson
        return response(200, terminalResponse(requestJson))
      }
    })
    const worker = createWorker(harness, http)

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SYNCED',
      recordCount: 5
    })

    const request = JSON.parse(submittedRequest) as { records: readonly { resourceType: string }[] }
    expect(request.records.map((record) => record.resourceType)).toEqual([
      'PATIENT',
      'SCREENING_SESSION',
      'SCREENING_ENCOUNTER',
      'VITALS',
      'LIFESTYLE'
    ])
    expect(readStatuses(harness.connection)).toEqual([
      ...Array.from({ length: 7 }, () => 'SENT'),
      'PENDING'
    ])
    expect(
      harness.connection
        .prepare('SELECT COUNT(*) AS count FROM sync_transport_resource_mappings')
        .get()
    ).toEqual({ count: 3 })
    const batch = harness.connection
      .prepare('SELECT status, response_json, response_sha256 FROM sync_transport_batches')
      .get() as { status: string; response_json: string; response_sha256: string }
    expect(batch.status).toBe('COMPLETED')
    expect(batch.response_json).toContain('"batchStatus":"PARTIAL"')
    expect(batch.response_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(() =>
      harness.connection.prepare("UPDATE sync_transport_batches SET response_json = '{}'").run()
    ).toThrow()
    harness.connection.close()
  })

  it('recovers an uncertain request by GET and reuses the exact stored bytes after retry', async () => {
    const harness = createHarness([
      'c0000000-0000-4000-8000-000000000001',
      'c0000000-0000-4000-8000-000000000002',
      'c0000000-0000-4000-8000-000000000003'
    ])
    seedPatientOnly(harness.connection)
    configure(harness.foundation)
    const submitted: string[] = []
    let submission = 0
    const http = httpClient({
      submitBatch: async (_credential, requestJson) => {
        submitted.push(requestJson)
        submission += 1
        return submission === 1
          ? { status: 'TRANSPORT_ERROR', errorCode: 'NETWORK_ERROR' }
          : response(200, acceptedResponse(requestJson))
      },
      recoverBatch: async () => response(404, problem(404, 'BATCH_NOT_AVAILABLE'))
    })
    const worker = createWorker(harness, http)

    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'RETRY_SCHEDULED' })
    harness.now.value = parseUtcTimestamp('2026-09-03T12:00:06.000Z')
    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'SYNCED' })

    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toBe(submitted[0])
    expect(
      harness.connection.prepare('SELECT attempt_count, status FROM sync_transport_batches').get()
    ).toEqual({ attempt_count: 2, status: 'COMPLETED' })
    expect(readStatuses(harness.connection)).toEqual(['SENT'])
    harness.connection.close()
  })

  it('releases a retryable record signal into a later batch while preserving batch history', async () => {
    const harness = createHarness([
      'ca000000-0000-4000-8000-000000000001',
      'ca000000-0000-4000-8000-000000000002',
      'ca000000-0000-4000-8000-000000000003',
      'ca000000-0000-4000-8000-000000000004'
    ])
    seedPatientOnly(harness.connection)
    configure(harness.foundation)
    let submission = 0
    const http = httpClient({
      submitBatch: async (_credential, requestJson) => {
        submission += 1
        if (submission === 2) return response(200, acceptedResponse(requestJson))
        const request = JSON.parse(requestJson) as {
          batchId: string
          records: readonly {
            recordId: string
            resourceType: string
            localResourceId: string
            sourceRevision: number
          }[]
        }
        const record = request.records[0]!
        return response(
          200,
          JSON.stringify({
            contractVersion: '1.0',
            batchId: request.batchId,
            batchStatus: 'PARTIAL',
            receivedAt: '2026-09-03T12:00:01.000Z',
            completedAt: '2026-09-03T12:00:02.000Z',
            outcomes: [
              {
                recordId: record.recordId,
                resourceType: record.resourceType,
                localResourceId: record.localResourceId,
                sourceRevision: record.sourceRevision,
                status: 'RETRY',
                canonicalResourceId: null,
                centralPersonId: null,
                chsMedicalId: null,
                medicalIdStatus: null,
                errors: [{ code: 'DEPENDENCY_NOT_AVAILABLE', path: '', retryable: true }]
              }
            ]
          })
        )
      }
    })
    const worker = createWorker(harness, http)

    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'SYNCED' })
    expect(readStatuses(harness.connection)).toEqual(['FAILED'])
    harness.now.value = parseUtcTimestamp('2026-09-03T12:00:06.000Z')
    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'SYNCED' })

    expect(readStatuses(harness.connection)).toEqual(['SENT'])
    expect(
      harness.connection
        .prepare('SELECT COUNT(*) AS count FROM sync_transport_batch_items WHERE outbox_id = ?')
        .get(patientOutboxOne)
    ).toEqual({ count: 2 })
    expect(
      harness.connection.prepare('SELECT COUNT(*) AS count FROM sync_transport_batches').get()
    ).toEqual({ count: 2 })
    harness.connection.close()
  })

  it('stores a Medical ID returned with an accepted patient outcome in the batch transaction', async () => {
    const harness = createHarness([
      'cb000000-0000-4000-8000-000000000001',
      'cb000000-0000-4000-8000-000000000002',
      'cb000000-0000-4000-8000-000000000003'
    ])
    seedPatientOnly(harness.connection)
    configure(harness.foundation)
    const worker = createWorker(
      harness,
      httpClient({
        submitBatch: async (_credential, requestJson) =>
          response(200, acceptedResponse(requestJson, true))
      })
    )

    await expect(worker.runOnce()).resolves.toMatchObject({
      status: 'SYNCED',
      identityDeliveriesApplied: 0
    })
    expect(
      harness.connection
        .prepare(
          'SELECT patient_id, central_person_id, chs_medical_id FROM sync_patient_identity_links'
        )
        .get()
    ).toEqual({
      patient_id: patientId,
      central_person_id: 'b0000000-0000-7000-8000-000000000001',
      chs_medical_id: 'CHS-ABCD-EFGH-JKMN'
    })
    expect(
      harness.connection
        .prepare(
          `SELECT identifier_value, status FROM patient_identifiers
           WHERE patient_id = ? AND identifier_type = 'CHS_MEDICAL_ID'`
        )
        .get(patientId)
    ).toEqual({ identifier_value: 'CHS-ABCD-EFGH-JKMN', status: 'ACTIVE' })
    harness.connection.close()
  })

  it('reuses the exact patient snapshot after a server Medical ID and a later outbox signal', async () => {
    const harness = createHarness(Array.from({ length: 12 }, () => randomUUID()))
    try {
      seedPatientOnly(harness.connection)
      configure(harness.foundation)
      const requests: string[] = []
      const worker = createWorker(
        harness,
        httpClient({
          submitBatch: async (_credential, requestJson) => {
            requests.push(requestJson)
            return response(200, acceptedResponse(requestJson, true))
          }
        })
      )
      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      insertOutbox(
        harness.connection,
        patientOutboxTwo,
        'PATIENT',
        patientId,
        'PATIENT_CREATED',
        at
      )
      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      expect(requests).toHaveLength(2)
      expect(JSON.parse(requests[1]!).records).toEqual(JSON.parse(requests[0]!).records)
      expect(JSON.parse(requests[1]!).records[0].payload.knownChsMedicalId).toBeNull()
      expect(readStatuses(harness.connection)).toEqual(['SENT', 'SENT'])
      expect(
        harness.connection
          .prepare(
            "SELECT identifier_value FROM patient_identifiers WHERE identifier_type = 'CHS_MEDICAL_ID'"
          )
          .get()
      ).toEqual({ identifier_value: 'CHS-ABCD-EFGH-JKMN' })
    } finally {
      harness.connection.close()
    }
  })

  it('recovers a proven legacy patient mismatch once, preserving clinical rows and rejected history', async () => {
    const harness = createHarness(Array.from({ length: 20 }, () => randomUUID()))
    try {
      seedPatientOnly(harness.connection)
      configure(harness.foundation)
      const requests: string[] = []
      const client = httpClient({
        submitBatch: async (_credential, requestJson) => {
          requests.push(requestJson)
          const body = JSON.parse(acceptedResponse(requestJson, true))
          if (requests.length > 1) body.outcomes[0].status = 'UNCHANGED'
          return response(200, JSON.stringify(body))
        }
      })
      expect(await createWorker(harness, client).runOnce()).toMatchObject({ status: 'SYNCED' })
      const legacy = insertLegacyPatientMismatch(harness.connection, requests[0]!)
      const patientBefore = harness.connection.prepare('SELECT * FROM patients').all()
      const identifiersBefore = harness.connection
        .prepare('SELECT * FROM patient_identifiers')
        .all()

      expect(await createWorker(harness, client).runOnce()).toMatchObject({ status: 'SYNCED' })
      expect(JSON.parse(requests[1]!).records).toEqual(JSON.parse(requests[0]!).records)
      expect(harness.connection.prepare('SELECT * FROM patients').all()).toEqual(patientBefore)
      expect(harness.connection.prepare('SELECT * FROM patient_identifiers').all()).toEqual(
        identifiersBefore
      )
      expect(
        harness.connection
          .prepare('SELECT response_json FROM sync_transport_batches WHERE id = ?')
          .get(legacy.batchId)
      ).toEqual({ response_json: legacy.responseJson })
      expect(
        harness.connection
          .prepare('SELECT status, last_error_code FROM sync_outbox WHERE id = ?')
          .get(legacy.recordId)
      ).toEqual({ status: 'SENT', last_error_code: 'RECORD_PAYLOAD_MISMATCH' })
      expect(
        harness.connection
          .prepare(
            "SELECT status FROM sync_outbox WHERE operation = 'PATIENT_SYNC_REPLAY_REQUESTED'"
          )
          .all()
      ).toEqual([{ status: 'SENT' }])
      expect(await createWorker(harness, client).runOnce()).toMatchObject({ status: 'IDLE' })
      expect(requests).toHaveLength(2)
      expect(
        harness.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM sync_outbox WHERE operation = 'PATIENT_SYNC_REPLAY_REQUESTED'"
          )
          .get()
      ).toEqual({ count: 1 })
    } finally {
      harness.connection.close()
    }
  })

  it.each(['changed-payload', 'unverified-identity', 'newer-revision'] as const)(
    'does not automatically replay a legacy patient mismatch with %s',
    async (scenario) => {
      const harness = createHarness(Array.from({ length: 12 }, () => randomUUID()))
      try {
        seedPatientOnly(harness.connection)
        configure(harness.foundation)
        let originalRequest = ''
        const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) => {
          originalRequest = requestJson
          return response(200, acceptedResponse(requestJson, true))
        })
        const worker = createWorker(harness, httpClient({ submitBatch }))
        expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
        insertLegacyPatientMismatch(
          harness.connection,
          originalRequest,
          scenario === 'changed-payload'
        )
        if (scenario === 'unverified-identity')
          harness.connection.prepare('DELETE FROM sync_patient_identity_links').run()
        if (scenario === 'newer-revision')
          harness.connection.prepare('UPDATE patients SET row_version = row_version + 1').run()
        expect(await worker.runOnce()).toMatchObject({ status: 'IDLE' })
        expect(submitBatch).toHaveBeenCalledOnce()
        expect(
          harness.connection
            .prepare(
              "SELECT COUNT(*) AS count FROM sync_outbox WHERE operation = 'PATIENT_SYNC_REPLAY_REQUESTED'"
            )
            .get()
        ).toEqual({ count: 0 })
      } finally {
        harness.connection.close()
      }
    }
  )

  it('rolls back a replay request if current patient content changed without a revision', async () => {
    const harness = createHarness(Array.from({ length: 12 }, () => randomUUID()))
    try {
      seedPatientOnly(harness.connection)
      configure(harness.foundation)
      let originalRequest = ''
      const submitBatch = vi.fn(async (_credential: unknown, requestJson: string) => {
        originalRequest = requestJson
        return response(200, acceptedResponse(requestJson, true))
      })
      const monitor = createSyncWorkerMonitor(() => at)
      const worker = createWorker(harness, httpClient({ submitBatch }), monitor)
      expect(await worker.runOnce()).toMatchObject({ status: 'SYNCED' })
      insertLegacyPatientMismatch(harness.connection, originalRequest)
      harness.connection
        .prepare("UPDATE patients SET display_name = 'Changed clinical content'")
        .run()
      expect(await worker.runOnce()).toEqual({ status: 'UNAVAILABLE' })
      expect(monitor.getLatest()).toMatchObject({
        diagnostic: { stage: 'PATIENT', rule: 'SNAPSHOT_REVISION_CONFLICT' }
      })
      expect(submitBatch).toHaveBeenCalledOnce()
      expect(
        harness.connection
          .prepare(
            "SELECT COUNT(*) AS count FROM sync_outbox WHERE operation = 'PATIENT_SYNC_REPLAY_REQUESTED'"
          )
          .get()
      ).toEqual({ count: 0 })
      expect(
        harness.connection.prepare('SELECT COUNT(*) AS count FROM sync_transport_batches').get()
      ).toEqual({ count: 2 })
    } finally {
      harness.connection.close()
    }
  })

  it('commits a reviewer decision before retrying the exact durable acknowledgment after restart', async () => {
    const harness = createHarness([
      'd0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000002'
    ])
    seedPatientWithoutOutbox(harness.connection)
    configure(harness.foundation)
    const acknowledgmentBodies: string[] = []
    let acknowledgmentAttempt = 0
    let pullAttempt = 0
    const delivery = {
      resolutionReference: 'e0000000-0000-7000-8000-000000000001',
      localPatientReference: patientId,
      localPatientCode: 'PT-000001',
      sourceRevision: 2,
      centralPersonId: 'e0000000-0000-7000-8000-000000000002',
      chsMedicalId: 'CHS-2345-6789-ABCD',
      resolvedAt: '2026-09-03T12:00:00.000Z'
    }
    const http = httpClient({
      pullIdentityResolutions: async () => {
        pullAttempt += 1
        return response(
          200,
          JSON.stringify({
            contractVersion: '1.0',
            deliveries: pullAttempt === 1 ? [delivery] : [],
            hasMore: false,
            serverTime: '2026-09-03T12:00:01.000Z'
          })
        )
      },
      acknowledgeIdentityResolution: async (_credential, requestJson) => {
        acknowledgmentBodies.push(requestJson)
        acknowledgmentAttempt += 1
        if (acknowledgmentAttempt === 1) {
          return { status: 'TRANSPORT_ERROR', errorCode: 'NETWORK_ERROR' }
        }
        const request = JSON.parse(requestJson) as {
          acknowledgmentId: string
          resolutionReference: string
        }
        return response(
          200,
          JSON.stringify({
            contractVersion: '1.0',
            acknowledgmentId: request.acknowledgmentId,
            resolutionReference: request.resolutionReference,
            status: 'ACKNOWLEDGED',
            acknowledgedAt: '2026-09-03T12:00:02.000Z',
            replayed: true
          })
        )
      }
    })

    await expect(createWorker(harness, http).runOnce()).resolves.toEqual({
      status: 'IDLE',
      identityDeliveriesApplied: 1
    })
    expect(
      harness.connection
        .prepare('SELECT acknowledged_at FROM sync_identity_resolution_deliveries')
        .get()
    ).toEqual({ acknowledged_at: null })
    expect(
      harness.connection
        .prepare(
          `SELECT identifier_value FROM patient_identifiers
           WHERE patient_id = ? AND identifier_type = 'CHS_MEDICAL_ID'`
        )
        .get(patientId)
    ).toEqual({ identifier_value: 'CHS-2345-6789-ABCD' })

    await expect(createWorker(harness, http).runOnce()).resolves.toEqual({
      status: 'IDLE',
      identityDeliveriesApplied: 0
    })
    expect(acknowledgmentBodies).toHaveLength(2)
    expect(acknowledgmentBodies[1]).toBe(acknowledgmentBodies[0])
    expect(
      harness.connection
        .prepare(
          'SELECT acknowledgment_json, acknowledged_at FROM sync_identity_resolution_deliveries'
        )
        .get()
    ).toEqual({
      acknowledgment_json: acknowledgmentBodies[0],
      acknowledged_at: '2026-09-03T12:00:02.000Z'
    })
    expect(
      harness.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM patient_identifiers
           WHERE patient_id = ? AND identifier_type = 'CHS_MEDICAL_ID'`
        )
        .get(patientId)
    ).toEqual({ count: 1 })
    expect(() =>
      harness.connection
        .prepare("UPDATE sync_identity_resolution_deliveries SET acknowledgment_json = '{}'")
        .run()
    ).toThrow()
    expect(() =>
      harness.connection
        .prepare(
          "UPDATE sync_identity_resolution_deliveries SET acknowledged_at = '2026-09-03T12:00:03.000Z'"
        )
        .run()
    ).toThrow()
    harness.connection.close()
  })

  it('fails closed without acknowledging a decision for a stale local patient revision', async () => {
    const harness = createHarness([
      'da000000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000002'
    ])
    seedPatientWithoutOutbox(harness.connection)
    configure(harness.foundation)
    const acknowledgeIdentityResolution = vi.fn<SyncHttpClient['acknowledgeIdentityResolution']>()
    const worker = createWorker(
      harness,
      httpClient({
        pullIdentityResolutions: async () =>
          response(
            200,
            JSON.stringify({
              contractVersion: '1.0',
              deliveries: [
                {
                  resolutionReference: 'ea000000-0000-7000-8000-000000000001',
                  localPatientReference: patientId,
                  localPatientCode: 'PT-000001',
                  sourceRevision: 1,
                  centralPersonId: 'ea000000-0000-7000-8000-000000000002',
                  chsMedicalId: 'CHS-3456-789A-BCDE',
                  resolvedAt: '2026-09-03T12:00:00.000Z'
                }
              ],
              hasMore: false,
              serverTime: '2026-09-03T12:00:01.000Z'
            })
          ),
        acknowledgeIdentityResolution
      })
    )

    await expect(worker.runOnce()).resolves.toEqual({ status: 'UNAVAILABLE' })
    expect(acknowledgeIdentityResolution).not.toHaveBeenCalled()
    expect(
      harness.connection
        .prepare('SELECT COUNT(*) AS count FROM sync_identity_resolution_deliveries')
        .get()
    ).toEqual({ count: 0 })
    expect(
      harness.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM patient_identifiers WHERE identifier_type = 'CHS_MEDICAL_ID'"
        )
        .get()
    ).toEqual({ count: 0 })
    harness.connection.close()
  })
})

function createDatabase(): Database.Database {
  const connection = new Database(':memory:')
  connection.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => at }
  })(connection)
  return connection
}

interface WorkerHarness {
  readonly connection: Database.Database
  readonly now: { value: UtcTimestamp }
  readonly transactionExecutor: DatabaseTransactionExecutor
  readonly foundation: SyncTransportFoundationService
}

function createHarness(ids: string[]): WorkerHarness {
  const connection = createDatabase()
  const now = { value: at }
  const transactionExecutor = createDatabaseTransactionExecutor({
    connection,
    idGenerator: createEntityIdGenerator(
      () => ids.shift() ?? 'f0000000-0000-4000-8000-000000000001'
    ),
    clock: createUtcClock(() => now.value),
    logger: { error: vi.fn() }
  })
  const foundation = createSyncTransportFoundationService({
    repository: createSyncTransportBatchRepository(connection),
    transactionExecutor,
    credentialProtector: protector()
  })
  return { connection, now, transactionExecutor, foundation }
}

function createWorker(
  harness: WorkerHarness,
  httpClient: SyncHttpClient,
  workerMonitor?: SyncWorkerMonitor
): SyncWorkerService {
  return createSyncWorkerService({
    foundation: harness.foundation,
    preparation: createPreparation(harness, workerMonitor),
    httpClient,
    repository: createSyncWorkerRepository(harness.connection),
    transactionExecutor: harness.transactionExecutor,
    random: () => 0.5,
    workerMonitor
  })
}

function createPreparation(
  harness: WorkerHarness,
  workerMonitor?: SyncWorkerMonitor
): SyncSnapshotPreparationService {
  return createSyncSnapshotPreparationService({
    snapshotRepository: createSyncSnapshotRepository(harness.connection),
    batchRepository: createSyncTransportBatchRepository(harness.connection),
    transactionExecutor: harness.transactionExecutor,
    desktopApplicationVersion: '1.0.0',
    desktopSchemaVersion: 21,
    onFailure: (diagnostic) => workerMonitor?.record('UNAVAILABLE', 'SNAPSHOT', diagnostic)
  })
}

function configure(foundation: ReturnType<typeof createSyncTransportFoundationService>): void {
  expect(
    foundation.configure({ apiBaseUrl: 'https://sync.example.org/', installationToken: token })
  ).toMatchObject({ status: 'CONFIGURED' })
}

function protector(): SyncCredentialProtector {
  return {
    isAvailable: () => true,
    protect: (value) => Buffer.from(`protected:${value}`),
    unprotect: (value) =>
      Buffer.from(value)
        .toString()
        .replace(/^protected:/, '')
  }
}

function httpClient(overrides: Partial<SyncHttpClient>): SyncHttpClient {
  const idle = async (): Promise<SyncHttpResult> => response(503, problem(503, 'UNAVAILABLE'))
  return {
    submitBatch: overrides.submitBatch ?? idle,
    recoverBatch: overrides.recoverBatch ?? idle,
    pullIdentityResolutions:
      overrides.pullIdentityResolutions ?? (async () => response(200, emptyPullResponse())),
    acknowledgeIdentityResolution: overrides.acknowledgeIdentityResolution ?? idle
  }
}

function response(httpStatus: number, bodyText: string): SyncHttpResult {
  return { status: 'RESPONSE', httpStatus, bodyText, retryAfterMs: null }
}

function problem(status: number, code: string): string {
  return JSON.stringify({ type: 'about:blank', title: 'Synthetic problem', status, code })
}

function emptyPullResponse(): string {
  return JSON.stringify({
    contractVersion: '1.0',
    deliveries: [],
    hasMore: false,
    serverTime: '2026-09-03T12:00:01.000Z'
  })
}

function acceptedResponse(requestJson: string, includeIdentity = false): string {
  const request = JSON.parse(requestJson) as {
    batchId: string
    records: readonly {
      recordId: string
      resourceType: string
      localResourceId: string
      sourceRevision: number
    }[]
  }
  return JSON.stringify({
    contractVersion: '1.0',
    batchId: request.batchId,
    batchStatus: 'ACCEPTED',
    receivedAt: '2026-09-03T12:00:01.000Z',
    completedAt: '2026-09-03T12:00:02.000Z',
    outcomes: request.records.map((record, index) => ({
      recordId: record.recordId,
      resourceType: record.resourceType,
      localResourceId: record.localResourceId,
      sourceRevision: record.sourceRevision,
      status: 'ACCEPTED',
      canonicalResourceId: `f0000000-0000-7000-8000-${String(index + 1).padStart(12, '0')}`,
      centralPersonId:
        includeIdentity && record.resourceType === 'PATIENT'
          ? 'b0000000-0000-7000-8000-000000000001'
          : null,
      chsMedicalId:
        includeIdentity && record.resourceType === 'PATIENT' ? 'CHS-ABCD-EFGH-JKMN' : null,
      medicalIdStatus: includeIdentity && record.resourceType === 'PATIENT' ? 'ASSIGNED' : null,
      errors: []
    }))
  })
}

function terminalResponse(requestJson: string): string {
  const accepted = JSON.parse(acceptedResponse(requestJson)) as {
    batchStatus: string
    outcomes: {
      resourceType: string
      status: string
      canonicalResourceId: string | null
      medicalIdStatus: string | null
      errors: { code: string; path: string; retryable: boolean }[]
    }[]
  }
  accepted.batchStatus = 'PARTIAL'
  const patient = accepted.outcomes.find((outcome) => outcome.resourceType === 'PATIENT')!
  patient.status = 'REVIEW_REQUIRED'
  patient.canonicalResourceId = null
  patient.medicalIdStatus = 'PENDING_REVIEW'
  patient.errors = [{ code: 'POSSIBLE_DUPLICATE', path: '', retryable: false }]
  const session = accepted.outcomes.find((outcome) => outcome.resourceType === 'SCREENING_SESSION')!
  session.status = 'UNCHANGED'
  const encounter = accepted.outcomes.find(
    (outcome) => outcome.resourceType === 'SCREENING_ENCOUNTER'
  )!
  encounter.status = 'REJECTED'
  encounter.canonicalResourceId = null
  encounter.errors = [{ code: 'INVALID_STATE', path: '/payload/status', retryable: false }]
  return JSON.stringify(accepted)
}

function readStatuses(connection: Database.Database): readonly string[] {
  return (
    connection.prepare('SELECT status FROM sync_outbox ORDER BY id').all() as readonly {
      status: string
    }[]
  ).map((row) => row.status)
}

function seedCompleteGraph(connection: Database.Database): void {
  seedPatientWithoutOutbox(connection)
  connection
    .prepare(
      `INSERT INTO consent_records (
         id, patient_id, consent_type, status, source_type, effective_at, withdrawn_at,
         notes, recorded_by, recorded_at, patient_prior_row_version, patient_resulting_row_version
       ) VALUES (?, ?, 'PATIENT_REGISTRY_ACKNOWLEDGMENT', 'ACKNOWLEDGED', 'LOCAL', ?, NULL,
                 NULL, ?, ?, 1, 2)`
    )
    .run('11000000-0000-4000-8000-000000000001', patientId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO screening_sessions (
         id, location_id, protocol_version_id, session_date, status, notes, opened_by,
         opened_at, closed_by, closed_at, created_by, created_at, updated_by, updated_at,
         row_version
       ) VALUES (?, ?, ?, '2026-09-03', 'CLOSED', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 2)`
    )
    .run(
      sessionId,
      locationId,
      '00000000-0000-4000-8000-000000000007',
      actorId,
      at,
      actorId,
      at,
      actorId,
      at,
      actorId,
      at
    )
  connection
    .prepare(
      `INSERT INTO screening_encounters (
         id, patient_id, screening_session_id, location_id, protocol_version_id, status,
         started_at, completed_at, source_type, recorded_by, amendment_of_encounter_id,
         amendment_reason, void_reason, record_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, 'LOCAL', ?, NULL, NULL, NULL, 2, ?, ?)`
    )
    .run(
      encounterId,
      patientId,
      sessionId,
      locationId,
      '00000000-0000-4000-8000-000000000007',
      at,
      at,
      actorId,
      at,
      at
    )
  connection
    .prepare(
      `INSERT INTO screening_vitals_drafts (
         id, encounter_id, status, weight_kg, waist_cm, notes, created_by, created_at,
         updated_by, updated_at, row_version
       ) VALUES (?, ?, 'VITALS_COMPLETE', 75.5, 90, NULL, ?, ?, ?, ?, 2)`
    )
    .run(vitalsId, encounterId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO screening_vitals_draft_readings (
         id, vitals_draft_id, sequence_number, systolic, diastolic, pulse,
         measurement_site, patient_position, measurement_time, created_at, updated_at
       ) VALUES (?, ?, 1, 128, 82, 70, 'RIGHT_ARM', 'SITTING', '12:30', ?, ?)`
    )
    .run('71000000-0000-4000-8000-000000000001', vitalsId, at, at)
  seedLifestyle(connection)

  insertOutbox(connection, patientOutboxOne, 'PATIENT', patientId, 'PATIENT_CREATED', at)
  insertOutbox(
    connection,
    patientOutboxTwo,
    'PATIENT',
    patientId,
    'PATIENT_ACKNOWLEDGMENT_RECORDED',
    '2026-09-03T12:00:01.000Z'
  )
  insertOutbox(
    connection,
    sessionOutbox,
    'SCREENING_SESSION',
    sessionId,
    'SCREENING_SESSION_CLOSED',
    at
  )
  insertOutbox(
    connection,
    encounterOutboxOne,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_ENCOUNTER_STARTED',
    at
  )
  insertOutbox(
    connection,
    encounterOutboxTwo,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_ENCOUNTER_COMPLETED',
    '2026-09-03T12:00:01.000Z'
  )
  insertOutbox(
    connection,
    vitalsOutbox,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_VITALS_STEP_COMPLETED',
    at
  )
  insertOutbox(
    connection,
    lifestyleOutbox,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_LIFESTYLE_STEP_COMPLETED',
    at
  )
  insertOutbox(
    connection,
    excludedOutbox,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_FOOD_DRAFT_SAVED',
    at
  )
}

function seedPatientOnly(connection: Database.Database): void {
  seedPatientWithoutOutbox(connection)
  insertOutbox(connection, patientOutboxOne, 'PATIENT', patientId, 'PATIENT_CREATED', at)
}

function seedPatientWithoutOutbox(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO users (
         id, username, username_normalized, display_name, password_hash, password_salt,
         role, is_active, must_change_password, failed_login_count, locked_until,
         last_login_at, created_at, updated_at
       ) VALUES (?, 'synthetic', 'synthetic', 'Synthetic Nurse', 'hash', 'salt', 'NURSE',
                 1, 0, 0, NULL, NULL, ?, ?)`
    )
    .run(actorId, at, at)
  connection
    .prepare(
      `INSERT INTO installation (
         singleton_id, id, deployment_name, timezone, created_at, updated_at
       ) VALUES (1, ?, 'Synthetic installation', 'Africa/Douala', ?, ?)`
    )
    .run(installationId, at, at)
  connection
    .prepare(
      `INSERT INTO locations (
         id, name, name_normalized, location_type, village, subdivision, region,
         directions, is_active, created_by, created_at, updated_by, updated_at
       ) VALUES (?, 'Synthetic clinic', 'synthetic clinic', 'CLINIC', NULL, NULL, NULL,
                 NULL, 1, ?, ?, ?, ?)`
    )
    .run(locationId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
         singleton_id, installation_id, location_id, configured_at, configured_by,
         updated_at, updated_by, row_version
       ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, locationId, at, actorId, at, actorId)
  connection
    .prepare(
      `INSERT INTO patients (
         id, patient_code, display_name, given_name, family_name, other_names,
         name_normalized, sex, date_of_birth, approximate_age_years, age_as_of_date,
         phone, phone_normalized, alternate_contact_name, alternate_contact_phone,
         village, quarter, residence_notes, status, created_by, created_at, updated_by,
         updated_at, row_version
       ) VALUES (?, 'PT-000001', 'Synthetic Patient', 'Synthetic', 'Patient', NULL,
                 'synthetic patient', 'FEMALE', '1980-01-01', NULL, NULL, NULL, NULL,
                 NULL, NULL, 'Village', NULL, NULL, 'ACTIVE', ?, ?, ?, ?, 2)`
    )
    .run(patientId, actorId, at, actorId, at)
}

function seedLifestyle(connection: Database.Database): void {
  const alcoholBaseline = '81000000-0000-4000-8000-000000000001'
  const tobaccoBaseline = '82000000-0000-4000-8000-000000000001'
  const workBaseline = '83000000-0000-4000-8000-000000000001'
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_baseline_versions (
         id, patient_id, installation_id, version, status, ever_consumed,
         consumed_past_12_months, common_beverage_types_json, other_beverage_description,
         created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', 'NO', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(alcoholBaseline, patientId, installationId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_baseline_versions (
         id, patient_id, installation_id, version, status, ever_regularly_used,
         former_use_approximate_stop_date, current_use_frequency, product_types_json,
         other_product_description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', NULL, 'NOT_AT_ALL', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(tobaccoBaseline, patientId, installationId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_work_baseline_versions (
         id, patient_id, installation_id, version, status, occupation_job_title,
         usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday,
         shift_pattern, description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'UNEMPLOYED', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
    )
    .run(workBaseline, patientId, installationId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_drafts (
         id, encounter_id, status, patient_id, screening_session_id, location_id,
         installation_id, period_start, period_end, alcohol_baseline_version_id,
         tobacco_baseline_version_id, work_baseline_version_id, created_by, created_at,
         updated_by, updated_at, row_version, other_activity_response
       ) VALUES (?, ?, 'COMPLETE', ?, ?, ?, ?, '2026-08-28', '2026-09-03', ?, ?, ?,
                 ?, ?, ?, ?, 2, 'NO')`
    )
    .run(
      lifestyleId,
      encounterId,
      patientId,
      sessionId,
      locationId,
      installationId,
      alcoholBaseline,
      tobaccoBaseline,
      workBaseline,
      actorId,
      at,
      actorId,
      at
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_weekly_records (
         id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks,
         largest_one_day_amount, days_at_largest_amount, common_beverage_types_json,
         other_beverage_description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', NULL, NULL, NULL, NULL, '[]', NULL, ?, ?, ?, ?)`
    )
    .run('84000000-0000-4000-8000-000000000001', lifestyleId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', ?, ?, ?, ?)`
    )
    .run('85000000-0000-4000-8000-000000000001', lifestyleId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_physical_activity_weekly_records (
         id, lifestyle_draft_id, weekly_response, sedentary_minutes_per_day,
         created_by, created_at, updated_by, updated_at, sedentary_time_response
       ) VALUES (?, ?, 'NO', 300, ?, ?, ?, ?, 'RECORDED')`
    )
    .run('86000000-0000-4000-8000-000000000001', lifestyleId, actorId, at, actorId, at)
  connection
    .prepare(
      `INSERT INTO lifestyle_work_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO_WORK', ?, ?, ?, ?)`
    )
    .run('87000000-0000-4000-8000-000000000001', lifestyleId, actorId, at, actorId, at)
}

function insertLegacyPatientMismatch(
  connection: Database.Database,
  originalRequest: string,
  changedPayload = false
): { batchId: string; recordId: string; responseJson: string } {
  const request = JSON.parse(originalRequest)
  request.batchId = randomUUID()
  request.records = request.records.filter(
    (record: { resourceType: string }) => record.resourceType === 'PATIENT'
  )
  const record = request.records[0]
  record.recordId = randomUUID()
  record.payload.knownChsMedicalId = 'CHS-ABCD-EFGH-JKMN'
  if (changedPayload) record.payload.displayName = 'Different patient content'
  const requestJson = JSON.stringify(request)
  const body = JSON.parse(acceptedResponse(requestJson))
  body.batchStatus = 'REJECTED'
  body.outcomes[0].status = 'REJECTED'
  body.outcomes[0].canonicalResourceId = null
  body.outcomes[0].errors = [{ code: 'RECORD_PAYLOAD_MISMATCH', path: '', retryable: false }]
  const responseJson = JSON.stringify(body)
  insertOutbox(connection, record.recordId, 'PATIENT', patientId, 'PATIENT_CREATED', at)
  connection
    .prepare(
      "UPDATE sync_outbox SET status = 'SENT', sent_at = ?, last_error_code = 'RECORD_PAYLOAD_MISMATCH' WHERE id = ?"
    )
    .run(at, record.recordId)
  connection
    .prepare(
      `INSERT INTO sync_transport_batches
    (id, request_json, request_sha256, status, created_at, completed_at, response_json, response_sha256)
    VALUES (?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`
    )
    .run(
      request.batchId,
      requestJson,
      createHash('sha256').update(requestJson).digest('hex'),
      at,
      at,
      responseJson,
      createHash('sha256').update(responseJson).digest('hex')
    )
  connection
    .prepare(
      'INSERT INTO sync_transport_batch_items (batch_id, outbox_id, sequence_number) VALUES (?, ?, 1)'
    )
    .run(request.batchId, record.recordId)
  return { batchId: request.batchId, recordId: record.recordId, responseJson }
}

function insertOutbox(
  connection: Database.Database,
  id: string,
  aggregateType: string,
  aggregateId: string,
  operation: string,
  createdAt: string
): void {
  connection
    .prepare(
      `INSERT INTO sync_outbox (
         id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version,
         created_at, status, attempt_count, next_attempt_at, last_error_code,
         last_error_message, sent_at
       ) VALUES (?, ?, ?, ?, '{}', 'synthetic.v1', ?, 'PENDING', 0, NULL, NULL, NULL, NULL)`
    )
    .run(id, aggregateType, aggregateId, operation, createdAt)
}

function seedReferralSyncGraph(
  connection: Database.Database,
  referralId: string,
  historyId: string,
  followupId: string
): void {
  connection
    .prepare(
      `INSERT INTO referrals (
         id, patient_id, encounter_id, protocol_version_id, reason_codes_json,
         urgency, due_date, status, created_by, created_at, record_version, updated_at
       ) VALUES (?, ?, ?, ?, '["BP_SCREENING_REFERRAL"]', 'STANDARD', '2026-09-08',
         'OPEN', ?, ?, 1, ?)`
    )
    .run(
      referralId,
      patientId,
      encounterId,
      '00000000-0000-4000-8000-000000000007',
      actorId,
      at,
      at
    )
  connection
    .prepare(
      `INSERT INTO referral_status_history (
         id, referral_id, from_status, to_status, change_reason, changed_by, changed_at
       ) VALUES (?, ?, NULL, 'OPEN', 'AUTOMATIC_SCREENING_REFERRAL', ?, ?)`
    )
    .run(historyId, referralId, actorId, at)
  connection
    .prepare(
      `INSERT INTO followups (
         id, referral_id, contact_date, contact_method, information_source,
         source_type, recorded_by, recorded_at
       ) VALUES (?, ?, '2026-09-03', 'PHONE', 'PATIENT', 'PATIENT_REPORTED', ?, ?)`
    )
    .run(followupId, referralId, actorId, at)
}
