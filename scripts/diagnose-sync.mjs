/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript CLI runs directly in Node without a TypeScript loader. */
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
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
  'LIFESTYLE_ENCOUNTER_STATE_INVALID',
  'POSSIBLE_DUPLICATE',
  'IDENTITY_VERIFICATION_REQUIRED',
  'INVALID_PATIENT_IDENTITY',
  'KNOWN_CHS_MEDICAL_ID_CONFLICT',
  'LOCAL_PATIENT_CODE_CONFLICT',
  'STALE_SOURCE_REVISION',
  'UNKNOWN_CHS_MEDICAL_ID'
])

// Only fixed schema fields and labels may reach diagnostic output. Parent IDs
// are used locally to correlate outcomes, never printed.
const parentDefinitions = {
  PATIENT: {
    table: 'patients',
    operations: [
      'PATIENT_CREATED',
      'PATIENT_SYNC_REPLAY_REQUESTED',
      'PATIENT_DEMOGRAPHICS_AMENDED',
      'PATIENT_ACKNOWLEDGMENT_RECORDED'
    ]
  },
  SCREENING_SESSION: {
    table: 'screening_sessions',
    operations: [
      'SCREENING_SESSION_CREATED',
      'SCREENING_SESSION_CLOSED',
      'SCREENING_SESSION_REOPENED'
    ]
  },
  SCREENING_ENCOUNTER: {
    table: 'screening_encounters',
    operations: [
      'SCREENING_ENCOUNTER_STARTED',
      'SCREENING_ENCOUNTER_COMPLETED',
      'SCREENING_ENCOUNTER_VOIDED'
    ]
  }
}

function missingParent(entry) {
  if (entry?.outcome.status !== 'RETRY') return null
  const path = entry.outcome.errors.find((error) => error.code === 'DEPENDENCY_NOT_AVAILABLE')?.path
  let type
  let field
  if (entry.record.resourceType === 'SCREENING_ENCOUNTER') {
    if (path === '/payload/localPatientId') [type, field] = ['PATIENT', 'localPatientId']
    if (path === '/payload/localScreeningSessionId')
      [type, field] = ['SCREENING_SESSION', 'localScreeningSessionId']
    if (path === '/payload/amendmentOfLocalEncounterId')
      [type, field] = ['SCREENING_ENCOUNTER', 'amendmentOfLocalEncounterId']
  } else if (entry.record.resourceType === 'VITALS' && path === '/payload/localEncounterId') {
    ;[type, field] = ['SCREENING_ENCOUNTER', 'localEncounterId']
  }
  const id = field && entry.record.payload[field]
  return type && typeof id === 'string' && id.length > 0 ? { type, id } : null
}

function dependencyContexts(db, latest) {
  const groups = new Map()
  let unclassifiedDependencyRetries = 0
  function parentState(parent) {
    const entry = latest.get(`${parent.type}:${parent.id}`)
    const definition = parentDefinitions[parent.type]
    const signals = { PENDING: 0, FAILED: 0, IN_FLIGHT: 0, SENT: 0 }
    for (const row of db
      .prepare(
        `SELECT status, count(*) AS count FROM sync_outbox
      WHERE aggregate_type = ? AND aggregate_id = ?
        AND operation IN (${definition.operations.map(() => '?').join(',')}) GROUP BY status`
      )
      .all(parent.type, parent.id, ...definition.operations)) {
      if (Object.hasOwn(signals, row.status)) signals[row.status] = Number(row.count)
    }
    return {
      resourceType: parent.type,
      existsLocally: !!db.prepare(`SELECT 1 FROM ${definition.table} WHERE id = ?`).get(parent.id),
      latestOutcome: entry ? safeLabel(entry.outcome.status, statuses) : 'NOT_OBSERVED',
      errorCodes: [
        ...new Set(
          (entry?.outcome.errors ?? []).map((error) => safeLabel(error.code, diagnosticErrors))
        )
      ].sort(),
      signals,
      identityLink:
        parent.type === 'PATIENT'
          ? db
              .prepare('SELECT 1 FROM sync_patient_identity_links WHERE patient_id = ?')
              .get(parent.id)
            ? 'PRESENT'
            : 'ABSENT'
          : 'NOT_APPLICABLE'
    }
  }
  for (const entry of latest.values()) {
    if (
      entry.outcome.status !== 'RETRY' ||
      !entry.outcome.errors.some((error) => error.code === 'DEPENDENCY_NOT_AVAILABLE')
    )
      continue
    const parent = missingParent(entry)
    if (!parent) {
      unclassifiedDependencyRetries++
      continue
    }
    let root = parent
    const visited = new Set([`${entry.record.resourceType}:${entry.record.localResourceId}`])
    let chainComplete = false
    for (let depth = 0; depth < 4; depth++) {
      const key = `${root.type}:${root.id}`
      if (visited.has(key)) break
      visited.add(key)
      const ancestor = latest.get(key)
      const next = missingParent(ancestor)
      if (!next) {
        chainComplete = !!ancestor && ancestor.outcome.status !== 'RETRY'
        break
      }
      root = next
    }
    const labels = {
      resourceType: entry.record.resourceType,
      waitingFor: parentState(parent),
      rootDependency: parentState(root),
      chainComplete
    }
    const key = JSON.stringify(labels)
    const group = groups.get(key) ?? { ...labels, records: 0, parents: new Set(), roots: new Set() }
    group.records++
    group.parents.add(parent.id)
    group.roots.add(root.id)
    groups.set(key, group)
  }
  return {
    dependencyFailures: [...groups.values()].map(({ parents, roots, ...group }) => ({
      ...group,
      distinctParents: parents.size,
      distinctRootParents: roots.size
    })),
    unclassifiedDependencyRetries
  }
}

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
    ...dependencyContexts(db, latest),
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
  let stage = 'ARGUMENTS'
  try {
    const options = new Map()
    const args = process.argv.slice(2)
    for (let i = 0; i < args.length; i += 2) {
      if (!['--db', '--installation-id'].includes(args[i]) || !args[i + 1] || options.has(args[i]))
        throw new Error()
      options.set(args[i], args[i + 1])
    }
    const expectedInstallation = options.get('--installation-id')
    if (
      expectedInstallation &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        expectedInstallation
      )
    )
      throw new Error()
    stage = 'DATABASE_LOCATION'
    const explicitPath = options.get('--db')
    if (!explicitPath && !process.env.APPDATA) throw new Error()
    const candidates = explicitPath
      ? [explicitPath]
      : ['health-screening-desktop', 'Health Screening Offline Desktop'].map((name) =>
          join(process.env.APPDATA, name, 'data', 'health-screening.sqlite3')
        )
    const checks = []
    const matches = []
    for (const [index, path] of candidates.entries()) {
      let candidate
      let result = 'NOT_FOUND'
      if (existsSync(path)) {
        try {
          result = 'OPEN_FAILED'
          candidate = new DatabaseSync(path, { readOnly: true })
          candidate.exec('PRAGMA busy_timeout = 2000')
          result = 'INSTALLATION_READ_FAILED'
          const installation = candidate
            .prepare('SELECT id FROM installation WHERE singleton_id = 1')
            .get()
          if (!installation || typeof installation.id !== 'string') throw new Error()
          result =
            !expectedInstallation ||
            installation.id.toLowerCase() === expectedInstallation.toLowerCase()
              ? 'MATCH'
              : 'DIFFERENT_INSTALLATION'
          if (result === 'MATCH') matches.push(path)
        } catch {
          // Emit only the fixed stage label, never a SQLite message or file path.
        } finally {
          candidate?.close()
        }
      }
      checks.push({
        candidate: explicitPath ? 'EXPLICIT' : index === 0 ? 'DEVELOPMENT' : 'INSTALLED',
        result
      })
    }
    if (matches.length !== 1) {
      console.error(
        JSON.stringify(
          {
            diagnosticStatus:
              matches.length > 1 ? 'MULTIPLE_MATCHING_DATABASES' : 'NO_MATCHING_DATABASE',
            nodeVersion: process.versions.node,
            databaseChecks: checks,
            nextStep:
              'Use --db with the active desktop database path; preserve the existing database.'
          },
          null,
          2
        )
      )
      process.exitCode = 1
    } else {
      stage = 'DATABASE_OPEN'
      db = new DatabaseSync(matches[0], { readOnly: true })
      db.exec('PRAGMA busy_timeout = 2000; BEGIN')
      stage = 'SUMMARY'
      if (
        expectedInstallation &&
        db.prepare('SELECT id FROM installation WHERE singleton_id = 1').get()?.id.toLowerCase() !==
          expectedInstallation.toLowerCase()
      )
        throw new Error()
      console.log(
        JSON.stringify(
          {
            diagnosticStatus: 'OK',
            nodeVersion: process.versions.node,
            databaseChecks: checks,
            ...summarizeSync(db)
          },
          null,
          2
        )
      )
      db.exec('ROLLBACK')
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          diagnosticStatus: 'UNAVAILABLE',
          stage,
          nodeVersion: process.versions.node,
          errorKind:
            error instanceof SyntaxError
              ? 'STORED_JSON_INVALID'
              : error?.code === 'ERR_SQLITE_ERROR'
                ? 'SQLITE_READ_FAILED'
                : 'CHECK_FAILED',
          nextStep:
            'Use Node 24. Optional arguments: --db <path> --installation-id <expected UUID>.'
        },
        null,
        2
      )
    )
    process.exitCode = 1
  } finally {
    db?.close()
  }
}
