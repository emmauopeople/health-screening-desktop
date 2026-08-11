# Screening Encounter IPC

HSD-029B exposes the approved HSD-029A encounter-start service through one fixed
IPC and preload boundary. It does not implement renderer UI, patient tabs,
measurements, completion, amendment, VOID, referrals, reports, sync transport,
or FHIR mapping.

## Channel

- `health-screening:screening-encounters:start`
- `health-screening:screening-encounters:vitals:get-draft`
- `health-screening:screening-encounters:vitals:save-draft`
- `health-screening:screening-encounters:vitals:complete-step`

The handler is registered by the application IPC registrar after the production
screening-encounter start service is composed. Duplicate focused registration is
rejected with a fixed registration error, and disposal removes only the
screening-encounter handler.

## Request

`start` accepts exactly:

- `patientId`
- `screeningSessionId`

Unknown fields are rejected. The renderer cannot provide actor, user, role,
location, encounter ID, protocol version, status, date, timestamp, installation,
record version, audit, outbox, measurement, recommendation, or referral data.

`vitals.getDraft` accepts exactly:

- `encounterId`

`vitals.saveDraft` and `vitals.completeStep` accept exactly:

- `encounterId`
- `expectedVersion`
- `readings`
- `weightKg`
- `waistCm`
- `notes`

Each reading accepts only `id`, `sequenceNumber`, `systolic`, `diastolic`,
`pulse`, `measurementSite`, `patientPosition`, and `measurementTime`. Draft save
permits incomplete readings. Complete-step validation requires complete readings
before workflow advancement. Unknown fields, renderer-supplied actor, role,
patient, session, location, installation, audit, force, bypass, override, or
sync authority are rejected before service execution.

## Main-Process Authority

The IPC handler validates the trusted sender frame with the established
navigation policy, validates the request shape, and then calls HSD-029A with
only the parsed request. It does not construct an actor or duplicate
authentication, authorization, location, date, ID, audit, or outbox policy.

HSD-029A obtains the authenticated actor from the local authentication session,
enforces approved roles and the established installation-wide location policy,
checks the authoritative deployment-local date, and writes encounter, audit, and
outbox rows atomically.

## Results

Expected HSD-029A statuses are returned as typed success data:

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

`STARTED` and `ALREADY_EXISTS` include only the approved encounter start
summary: encounter ID, patient ID, screening-session ID, status, started
timestamp, and record version. IPC sender failures use the existing sanitized
IPC failure envelope.

Raw exceptions, SQL, database paths, stack traces, authentication internals,
patient records, session records, audit rows, outbox rows, and clinical data are
not returned.

## Preload

`window.healthScreening.screeningEncounters.start(request)` validates the same
strict request schema before invoking IPC, uses only the fixed channel, validates
the main-process response, and returns deeply frozen results. It exposes no
`ipcRenderer`, dynamic channels, subscriptions, Electron event objects,
filesystem, shell, network, storage, repository, or service objects.

Malformed local requests return the HSD-029A `VALIDATION_FAILED` status.
Invocation failures or malformed main-process responses return the HSD-029A
`UNAVAILABLE` status.

## HSD-029C Boundary

The HSD-029C Screening workspace calls this preload method only after P1 has
returned a sanitized current daily-session context. The renderer passes only
`patientId` and the P1 `screeningSessionId`; it does not pass location, date,
actor, role, status, or audit metadata, and it must not bypass preload
validation or treat renderer state as authorization.

## HSD-030A Vitals Draft Boundary

HSD-030A extends `window.healthScreening.screeningEncounters` with the fixed
`vitals.getDraft`, `vitals.saveDraft`, and `vitals.completeStep` methods. The
preload validates strict request schemas before invoking the fixed channels,
validates the response envelopes, deeply freezes returned data, and maps invoke
failures or malformed responses to sanitized `UNAVAILABLE` results.

The main-process handlers validate the trusted sender before request parsing,
then call the Vitals draft application service. The service resolves
authentication and screening authorization, P0 configured location, current
daily session, encounter ownership, timestamps, audit actor, and transaction
ownership in the main process. The renderer cannot provide any of those
authorities.

Successful `saveDraft` returns `SAVED` with the sanitized draft and does not
advance the workflow. Successful `completeStep` returns `COMPLETED` with the
sanitized draft after Vitals persistence succeeds. Controlled failures include
authentication, authorization, validation, location, encounter, session,
version-conflict, and unavailable outcomes. Raw SQL, SQLite messages, database
paths, stack traces, patient records, audit rows, outbox rows, clinical logs,
and internal repository rows are not returned.
