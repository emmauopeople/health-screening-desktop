/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript CLI runs directly in Node without a TypeScript loader. */
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const resources = new Set([
  'PATIENT',
  'SCREENING_SESSION',
  'SCREENING_ENCOUNTER',
  'VITALS',
  'LIFESTYLE',
  'FOOD',
  'OTC'
])
const statuses = new Set(['ACCEPTED', 'UNCHANGED', 'REVIEW_REQUIRED', 'REJECTED', 'RETRY'])
const diagnosticErrors = new Set([
  'DEPENDENCY_NOT_AVAILABLE',
  'RECORD_PAYLOAD_MISMATCH',
  'RECORD_IN_PROGRESS',
  'ENCOUNTER_STATE_REGRESSION',
  'ENCOUNTER_TERMINAL_CONFLICT',
  'ENCOUNTER_VOID',
  'MEASUREMENT_PERIOD_INVALID',
  'LIFESTYLE_ENCOUNTER_STATE_INVALID'
])

function safeLabel(value, allowed) {
  return value == null ? 'MISSING' : allowed.has(value) ? value : 'OTHER'
}

function outstandingContexts(db, latest) {
  const states = { PENDING: 0, FAILED: 0, IN_FLIGHT: 0 }
  const lifestyle = new Map()
  const failed = new Map()
  function group(groups, labels, row) {
    const key = JSON.stringify(labels)
    const entry = groups.get(key) ?? { ...labels, signalCount: 0, encounters: new Set() }
    entry.signalCount++
    if (row.encounter_id) entry.encounters.add(row.encounter_id)
    groups.set(key, entry)
  }
  for (const row of db
    .prepare(
      `
    SELECT o.operation, o.status, o.last_error_code,
      e.id AS encounter_id, e.patient_id, e.status AS encounter_status,
      d.status AS draft_status,
      EXISTS(SELECT 1 FROM sync_patient_identity_links p WHERE p.patient_id = e.patient_id) AS linked
    FROM sync_outbox o
    LEFT JOIN screening_encounters e
      ON o.aggregate_type = 'SCREENING_ENCOUNTER' AND e.id = o.aggregate_id
    LEFT JOIN lifestyle_drafts d ON d.encounter_id = e.id
    WHERE o.status IN ('PENDING', 'FAILED', 'IN_FLIGHT')
    ORDER BY o.operation, o.status, o.aggregate_id
  `
    )
    .iterate()) {
    states[row.status]++
    if (typeof row.operation === 'string' && row.operation.startsWith('SCREENING_LIFESTYLE_')) {
      group(
        lifestyle,
        {
          signalStatus: row.status,
          draftStatus: safeLabel(row.draft_status, new Set(['DRAFT', 'IN_PROGRESS', 'COMPLETE'])),
          encounterStatus: safeLabel(
            row.encounter_status,
            new Set(['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])
          ),
          completionSignal: row.operation === 'SCREENING_LIFESTYLE_STEP_COMPLETED'
        },
        row
      )
    }
    if (row.status !== 'FAILED') continue
    const resourceType = [
      'SCREENING_ENCOUNTER_STARTED',
      'SCREENING_ENCOUNTER_COMPLETED',
      'SCREENING_ENCOUNTER_VOIDED'
    ].includes(row.operation)
      ? 'SCREENING_ENCOUNTER'
      : ['SCREENING_VITALS_DRAFT_SAVED', 'SCREENING_VITALS_STEP_COMPLETED'].includes(row.operation)
        ? 'VITALS'
        : 'OTHER'
    group(
      failed,
      {
        resourceType,
        errorCode: safeLabel(row.last_error_code, diagnosticErrors),
        patientOutcome: safeLabel(
          latest.get(`PATIENT:${row.patient_id}`)?.outcome.status,
          statuses
        ),
        patientIdentityLink: row.linked ? 'PRESENT' : 'ABSENT',
        encounterOutcome: safeLabel(
          latest.get(`SCREENING_ENCOUNTER:${row.encounter_id}`)?.outcome.status,
          statuses
        )
      },
      row
    )
  }
  function counts(groups) {
    return [...groups.values()].map(({ encounters, ...entry }) => ({
      ...entry,
      encounterCount: encounters.size
    }))
  }
  return {
    outstandingSignalsByState: states,
    outstandingSignalsTotal: Object.values(states).reduce((sum, count) => sum + count, 0),
    pendingLifestyleContexts: counts(lifestyle),
    failedSignalContexts: counts(failed)
  }
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1
}

function localMinute(timestamp, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((p) => [p.type, p.value])
  )
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`)
}

export function summarizeSync(db) {
  const timezone = db
    .prepare('SELECT timezone FROM installation WHERE singleton_id = 1')
    .get()?.timezone
  if (typeof timezone !== 'string' || timezone.length > 128) throw new Error('Missing time zone')
  // Validate the zone before including this configuration value in the report.
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  const latest = new Map()
  const acceptedEncounters = new Map()
  let completedBatches = 0
  for (const batch of db
    .prepare(
      `SELECT request_json, response_json FROM sync_transport_batches
    WHERE response_json IS NOT NULL ORDER BY created_at, id`
    )
    .iterate()) {
    completedBatches++
    const request = JSON.parse(batch.request_json)
    const response = JSON.parse(batch.response_json)
    for (const outcome of response.outcomes) {
      const record = request.records.find(
        (r) => r.recordId === outcome.recordId && r.resourceType === outcome.resourceType
      )
      if (!record || !resources.has(record.resourceType) || !statuses.has(outcome.status)) continue
      latest.set(`${record.resourceType}:${record.localResourceId}`, { record, outcome })
      if (
        record.resourceType === 'SCREENING_ENCOUNTER' &&
        ['ACCEPTED', 'UNCHANGED'].includes(outcome.status)
      ) {
        acceptedEncounters.set(record.localResourceId, record.payload)
      }
    }
  }

  const outcomes = {}
  const timing = {}
  const minutesBeforeStart = {}
  const lifestyleEncounterStates = {}
  const snapshotErrors = {}
  for (const { record, outcome } of latest.values()) {
    increment(outcomes, `${record.resourceType}/${outcome.status}`)
    if (['REJECTED', 'RETRY'].includes(outcome.status)) {
      for (const error of outcome.errors) {
        increment(
          snapshotErrors,
          `${record.resourceType}/${outcome.status}/${safeLabel(error.code, diagnosticErrors)}`
        )
      }
    }
    if (
      record.resourceType === 'LIFESTYLE' &&
      outcome.errors.some((e) => e.code === 'LIFESTYLE_ENCOUNTER_STATE_INVALID')
    ) {
      const state = acceptedEncounters.get(record.payload.localEncounterId)?.status
      increment(
        lifestyleEncounterStates,
        ['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'].includes(state) ? state : 'UNKNOWN'
      )
    }
    if (record.resourceType !== 'VITALS') continue
    for (const error of outcome.errors.filter((e) => e.code === 'MEASUREMENT_PERIOD_INVALID')) {
      const index = /^\/payload\/readings\/(\d+)$/.exec(error.path)?.[1]
      const reading = index === undefined ? undefined : record.payload.readings[Number(index)]
      const encounter = acceptedEncounters.get(record.payload.localEncounterId)
      if (!reading || !encounter) {
        increment(timing, 'MISSING_ACCEPTED_CONTEXT')
        continue
      }
      const measurement = Date.parse(
        `${reading.measurementLocalDate}T${reading.measurementLocalTime}:00Z`
      )
      const start = localMinute(encounter.startedAt, reading.measurementTimezone)
      const end =
        encounter.completedAt === null
          ? null
          : localMinute(encounter.completedAt, reading.measurementTimezone)
      if (![measurement, start, end ?? start].every(Number.isFinite)) {
        increment(timing, 'INVALID_TIME')
        continue
      }
      if (measurement < start) {
        increment(timing, 'BEFORE_START_MINUTE')
        increment(minutesBeforeStart, String((start - measurement) / 60_000))
      } else if (measurement === start && new Date(encounter.startedAt).getTime() % 60_000 !== 0) {
        increment(timing, 'SAME_START_MINUTE_PRECISION')
      } else if (end !== null && measurement > end) {
        increment(timing, 'AFTER_COMPLETION_MINUTE')
      } else if (Number(index) > 0) {
        increment(timing, 'CHECK_READING_ORDER')
      } else {
        increment(timing, 'WITHIN_LATEST_ACCEPTED_ENCOUNTER')
      }
    }
  }

  const queued = db
    .prepare(
      `SELECT operation, COUNT(*) AS count FROM sync_outbox
    WHERE status IN ('PENDING', 'FAILED') GROUP BY operation`
    )
    .all()
  const pendingIntake = {}
  for (const [operation, label] of [
    ['SCREENING_FOOD_FINALIZED', 'FOOD'],
    ['SCREENING_OTC_FINALIZED', 'OTC']
  ]) {
    pendingIntake[label] = Number(queued.find((row) => row.operation === operation)?.count ?? 0)
  }
  return {
    schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
    installationTimezone: timezone,
    computerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    completedBatches,
    latestSnapshotOutcomes: outcomes,
    latestSnapshotErrors: snapshotErrors,
    ...outstandingContexts(db, latest),
    timingComparison:
      'Recorded measurement minute versus latest accepted encounter snapshot; no timestamps or clinical values are printed.',
    vitalsPeriodFailureCounts: timing,
    minutesBeforeEncounterStart: minutesBeforeStart,
    lifestyleRejectedEncounterStates: lifestyleEncounterStates,
    pendingFinalizedIntake: pendingIntake,
    pendingOrFailedSignals: queued.reduce((total, row) => total + Number(row.count), 0)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let db
  try {
    const explicitPath =
      process.argv.length === 4 && process.argv[2] === '--db' ? process.argv[3] : null
    if ((!explicitPath && process.argv.length !== 2) || (!explicitPath && !process.env.APPDATA)) {
      throw new Error('Invalid invocation')
    }
    const dbPath =
      explicitPath ??
      join(process.env.APPDATA, 'health-screening-desktop', 'data', 'health-screening.sqlite3')
    db = new DatabaseSync(dbPath, { readOnly: true })
    console.log(JSON.stringify(summarizeSync(db), null, 2))
  } catch {
    console.error(
      'Diagnostic unavailable. Use Node 24 and an existing desktop database. Optional usage: node scripts/diagnose-sync.mjs --db <path>'
    )
    process.exitCode = 1
  } finally {
    db?.close()
  }
}
