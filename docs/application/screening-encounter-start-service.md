# Screening Encounter Start Service

HSD-029A adds the main-process boundary for starting or retrieving the
canonical root screening encounter for an existing patient in an eligible
screening session.

## Enrollment Meaning

Enrollment means linking one existing eligible patient to one existing eligible
screening session by creating the canonical root `DRAFT` encounter row, or
returning the existing root encounter when it already exists.

It does not register patients, edit demographics, enter measurements, complete
or amend encounters, create referrals, run protocol calculations, expose IPC or
preload APIs, or add renderer workflows.

## Request

The service accepts only:

- `patientId`
- `screeningSessionId`

The caller cannot supply encounter IDs, actor data, session state, location
authority, protocol versions, status, session date, timestamps, record
versions, audit metadata, outbox metadata, or clinical values.

## Eligibility

The patient must exist and have status `ACTIVE`.

The screening session must exist, belong to an active location, have status
`OPEN`, and have a session date equal to the deployment-local date calculated
from the transaction UTC timestamp and the installation IANA timezone.

The service does not use renderer-provided dates, JavaScript wall-clock time, or
the operating-system timezone as the date authority.

## Authentication And Authorization

The service obtains the actor from the established in-memory local
authentication session by calling `requireAnyRole()`. The session must be
`ACTIVE`; signed-out, locked, password-change-required, expired, malformed, or
otherwise unavailable session states fail with sanitized service results.

Approved operational roles are:

- `LOCAL_ADMIN`
- `NURSE`
- `TRAINED_SCREENER`

Actor authority is never request-controlled. The encounter `recorded_by`, audit
user, and outbox actor fields come from the trusted active session.

The established location policy is installation-wide operational authorization:
the schema and repositories define no user-to-location assignment table, and
the existing screening-session workspace exposes active locations to approved
operational roles. HSD-029A therefore validates the session's persisted
location exists and is active, while `requireAnyRole()` is the authorization
gate for operation access. Request data cannot override the session location.

## Canonical Root Identity

The service follows the schema-version-5 identity rule:

- one root encounter per patient and screening session;
- root encounters have `amendment_of_encounter_id IS NULL`;
- amendment rows do not replace the root identity;
- a `VOID` root encounter still occupies the identity.

Repeated starts return `ALREADY_EXISTS` with the existing root encounter summary
and do not create duplicate audit or outbox rows.

## Repository Boundary

The screening-encounter repository exposes only focused start-service methods:

- `getById`
- `getByIdForWrite`
- `findCanonicalRootByPatientAndSession`
- `findCanonicalRootByPatientAndSessionForWrite`
- `insertCanonicalRoot`

The repository uses explicit column lists, parameterized SQL, validated row
decoding, and the approved SQLite identity-conflict classifier. It does not add
list, report, amendment, completion, void, or measurement queries.

## Results

The start service returns immutable typed results:

- `STARTED`
- `ALREADY_EXISTS`
- `PATIENT_NOT_FOUND`
- `PATIENT_INELIGIBLE`
- `SESSION_NOT_FOUND`
- `SESSION_CLOSED`
- `SESSION_NOT_CURRENT`
- `LOCATION_NOT_FOUND`
- `LOCATION_INACTIVE`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `AUTHENTICATION_REQUIRED`
- `UNAVAILABLE`

Successful results include only the encounter ID, patient ID, screening-session
ID, encounter status, started timestamp, and record version.

## Audit And Outbox

A newly started encounter writes exactly one audit event and one pending
sync-outbox row in the same transaction as the encounter insert.

Audit:

- entity type: `SCREENING_ENCOUNTER`
- action: `SCREENING_ENCOUNTER_STARTED`

Outbox:

- aggregate type: `SCREENING_ENCOUNTER`
- operation: `SCREENING_ENCOUNTER_STARTED`
- payload schema version: `screening-encounter.start.v1`

Audit metadata and outbox payloads are minimized. They exclude patient names,
birth dates, contact information, addresses, notes, clinical measurements,
recommendations, raw errors, SQL, database paths, and complete records.

## Atomicity

Encounter creation, audit insertion, and outbox insertion commit or roll back
together through `DatabaseTransactionExecutor.run`. If the encounter insert,
audit insert, or outbox insert fails, no partial write remains.

When the database identity constraint wins a race, the service re-reads the
canonical root encounter and returns `ALREADY_EXISTS` without writing another
audit or outbox event. Encounter-ID collisions are not treated as idempotent
identity conflicts.

Tests include both a deterministic simulated identity-conflict recovery case and
a two-connection service verification. SQLite serializes writers, so the
two-connection test uses explicit ordering: one independently composed service
commits the root encounter, and a second independently composed service on a
separate connection returns the same authoritative encounter as
`ALREADY_EXISTS`.

## HSD-029B Boundary

Future work may expose this boundary through IPC and preload. Patient-to-session
renderer workflows, clinical measurements, encounter completion, amendments,
referrals, reports, sync transport, and FHIR mapping remain out of scope.
