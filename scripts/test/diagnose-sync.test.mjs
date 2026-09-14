/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript tests run directly with node --test. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { summarizeSync } from '../diagnose-sync.mjs'

function seed(db) {
  db.exec(`PRAGMA user_version = 22;
    CREATE TABLE installation (singleton_id INTEGER, timezone TEXT);
    INSERT INTO installation VALUES (1, 'Africa/Douala');
    CREATE TABLE sync_transport_batches (id TEXT, created_at TEXT, request_json TEXT, response_json TEXT);
    CREATE TABLE sync_outbox (operation TEXT, status TEXT);
    INSERT INTO sync_outbox VALUES ('SCREENING_FOOD_FINALIZED', 'PENDING'), ('SCREENING_OTC_FINALIZED', 'PENDING');`)
  const encounter = {
    recordId: 'private-record',
    resourceType: 'SCREENING_ENCOUNTER',
    localResourceId: 'private-encounter',
    payload: {
      status: 'COMPLETED',
      startedAt: '2026-09-14T11:05:37.123Z',
      completedAt: '2026-09-14T12:00:00Z',
      notes: 'private clinical text'
    }
  }
  const records = [encounter]
  const outcomes = [
    {
      recordId: encounter.recordId,
      resourceType: encounter.resourceType,
      status: 'ACCEPTED',
      errors: []
    }
  ]
  for (const time of ['12:05', '06:05', '13:01']) {
    const record = {
      recordId: `private-${time}`,
      localResourceId: `private-${time}`,
      resourceType: 'VITALS',
      payload: {
        localEncounterId: encounter.localResourceId,
        readings: [
          {
            measurementLocalDate: '2026-09-14',
            measurementLocalTime: time,
            measurementTimezone: 'Africa/Douala'
          }
        ]
      }
    }
    records.push(record)
    outcomes.push({
      recordId: record.recordId,
      resourceType: 'VITALS',
      status: 'REJECTED',
      errors: [{ code: 'MEASUREMENT_PERIOD_INVALID', path: '/payload/readings/0' }]
    })
  }
  db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
    'private-batch',
    '2026-09-14',
    JSON.stringify({ records }),
    JSON.stringify({ outcomes })
  )
}

test('distinguishes minute precision from multi-hour offsets and preserves privacy', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    const summary = summarizeSync(db)
    assert.deepEqual(summary.vitalsPeriodFailureCounts, {
      SAME_START_MINUTE_PRECISION: 1,
      BEFORE_START_MINUTE: 1,
      AFTER_COMPLETION_MINUTE: 1
    })
    assert.deepEqual(summary.minutesBeforeEncounterStart, { 360: 1 })
    assert.deepEqual(summary.pendingFinalizedIntake, { FOOD: 1, OTC: 1 })
    assert.deepEqual(summary.latestSnapshotOutcomes, {
      'SCREENING_ENCOUNTER/ACCEPTED': 1,
      'VITALS/REJECTED': 3
    })
    assert.equal(JSON.stringify(summary).includes('private'), false)
    assert.equal(JSON.stringify(summary).includes('2026-09-14'), false)
  } finally {
    db.close()
  }
})

test('CLI reads the database without modifying it and never creates a missing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chs-sync-diagnostic-'))
  try {
    const path = join(directory, 'fixture.sqlite3')
    const db = new DatabaseSync(path)
    seed(db)
    db.close()
    const before = readFileSync(path)
    const script = fileURLToPath(new URL('../diagnose-sync.mjs', import.meta.url))
    const output = spawnSync(process.execPath, [script, '--db', path], {
      encoding: 'utf8'
    })
    assert.equal(output.status, 0, output.stderr)
    assert.equal(JSON.parse(output.stdout).completedBatches, 1)
    assert.deepEqual(readFileSync(path), before)
    const missing = join(directory, 'missing.sqlite3')
    const failure = spawnSync(process.execPath, [script, '--db', missing], {
      encoding: 'utf8'
    })
    assert.equal(failure.status, 1)
    assert.equal(existsSync(missing), false)
    assert.equal(failure.stderr.includes(missing), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
