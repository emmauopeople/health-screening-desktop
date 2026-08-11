# Screening Vitals Draft Service

HSD-030A adds local, offline-first persistence for the Vitals step inside an
existing root screening encounter. The encounter remains the ownership boundary:
one encounter can have at most one Vitals draft, and that draft can contain
multiple ordered blood-pressure readings.

## Operations

The main-process service exposes three focused operations:

- `getVitalsDraft({ encounterId })`
- `saveVitalsDraft({ encounterId, expectedVersion, readings, weightKg, waistCm, notes })`
- `completeVitalsStep({ encounterId, expectedVersion, readings, weightKg, waistCm, notes })`

The renderer may provide only the encounter identifier returned by the approved
encounter-start boundary and the draft form fields. The main process resolves
the authenticated actor, authorization, configured installation location,
encounter ownership, lifecycle state, audit actor, timestamps, and transaction
ownership. Existing encounter recovery validates the persisted session and
location attribution without requiring the persisted session date to equal
today. Requests that include actor, role, installation, location, session,
patient, audit, force, bypass, override, or sync authority are rejected by the
fixed IPC contract.

`LOCAL_ADMIN`, `NURSE`, and `TRAINED_SCREENER` are authorized to load and edit
Vitals drafts when the encounter is a canonical root `DRAFT` encounter in its
persisted `OPEN` session, the encounter and session retain the configured
location attribution, and the location remains active. An existing editable
encounter may belong to an earlier session date; its session, location, and
historical attribution are never reassigned. Non-draft encounters, amendment
rows, closed sessions, missing or inactive locations, and absent authentication
return sanitized controlled outcomes. New encounter creation remains under P1
and continues to require the authoritative current daily session.

## Draft Rules

Reading 1 always exists in the Vitals UI and cannot be removed. It is created
in renderer state only when no persisted draft exists; the empty initial form is
not written automatically.

`Add reading` appends later readings. Reading 2 and later can be removed in the
UI, and removal is reflected only after a successful `saveVitalsDraft` or
`completeVitalsStep` transaction. Visible reading labels are sequential, while
persisted reading IDs remain stable across renumbering.

`saveVitalsDraft` permits incomplete readings and optional fields. It persists
the structured draft locally without advancing the workflow and returns the
authoritative row version after the transaction commits. The UI displays
`Draft saved` only after that result is returned.

`completeVitalsStep` requires Reading 1 and every remaining reading to be
complete and valid before persistence. A complete reading contains systolic,
diastolic, pulse, measurement site, patient position, and measurement time.
Weight, waist measurement, and notes are optional and may remain empty. Empty
optional values are persisted as absent values, not zero.

Provided numeric values must be positive. Measurement site is limited to
`RIGHT_ARM`, `LEFT_ARM`, `LEFT_LEG`, and `RIGHT_LEG`. Patient position is
limited to `LYING`, `STANDING`, and `SITTING`. Measurement time uses `HH:MM`
with a valid 00 through 23 hour. No clinical interpretation thresholds,
diagnoses, referrals, or recommendations are introduced by this task.

## Transactions And Concurrency

A draft creation, draft update, reading reconciliation, audit, and outbox write
use one caller-owned write transaction. Updates use the persisted draft row
version. Existing readings are reconciled by stable reading ID: their
`created_at` values are preserved while mutable fields, order, and `updated_at`
are changed; new readings receive new database-managed creation timestamps; and
omitted readings are removed in the same transaction.
A stale version returns `VERSION_CONFLICT` unless the request is an idempotent
repeat of the current persisted draft. Identical saves return the current draft
without duplicating audit or outbox rows.

Repeated saves update the same draft row. Saving one encounter cannot read or
overwrite another encounter's Vitals data, and closing a patient tab does not
delete, complete, cancel, or alter the encounter or saved draft.

## Audit And Outbox

Successful draft saves use `SCREENING_VITALS_DRAFT_SAVED`. Successful Vitals
completion uses `SCREENING_VITALS_STEP_COMPLETED`. Audit metadata and outbox
payloads contain only non-clinical identifiers and lifecycle metadata: draft
ID, encounter ID, draft status, reading count, and row version.

Clinical measurements, notes, patient names, dates of birth, patient codes,
raw request payloads, SQL, database paths, and raw SQLite messages are not
logged or emitted through audit/outbox metadata.

## Renderer Behavior

When a patient tab becomes active in New Screening, the renderer loads the
authoritative draft through the fixed preload method. It shows a loading state
without stale data from another patient, restores persisted readings and
optional fields from the same encounter even when its session date is earlier
than today, and ignores stale completion after unmount or tab changes.

`Save draft` remains on Vitals. `Continue to Lifestyle` validates the form,
persists the Vitals step, and advances only after local persistence succeeds.
Lifestyle remains a placeholder in this task; Lifestyle, Food, OTC, Review,
recommendations, referrals, printing, reporting, sync transport, and FHIR are
not implemented.
