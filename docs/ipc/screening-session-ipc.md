# Screening Session IPC Boundary

HSD-028A exposes the HSD-027 screening-session application service through authenticated main-process IPC handlers. HSD-028B exposes those fixed channels through the validated `window.healthScreening.screeningSessions` preload group. Renderer workspace state, encounters, measurements, protocol calculation, referrals, reports, and sync transport remain outside these checkpoints.

## Channels

| Operation                               | Channel                                                     | Request                                                    |
| --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `screeningSessions.getWorkspaceContext` | `health-screening:screening-sessions:get-workspace-context` | `{}`                                                       |
| `screeningSessions.ensureCurrent`       | `health-screening:screening-sessions:ensure-current`        | no payload or strict `{}`                                  |
| `screeningSessions.create`              | `health-screening:screening-sessions:create`                | `{ locationId, sessionDate, notes? }`                      |
| `screeningSessions.close`               | `health-screening:screening-sessions:close`                 | `{ id, expectedRowVersion, reason? }`                      |
| `screeningSessions.reopen`              | `health-screening:screening-sessions:reopen`                | `{ id, expectedRowVersion, reason }`                       |
| `screeningSessions.getById`             | `health-screening:screening-sessions:get-by-id`             | `{ id }`                                                   |
| `screeningSessions.list`                | `health-screening:screening-sessions:list`                  | `{ locationId, status, dateFrom, dateTo, page, pageSize }` |

Requests are strict own-property objects. They reject renderer-supplied actor
IDs, roles, protocol versions during creation, generated IDs, timestamps,
lifecycle-history data, audit data, outbox data, create status, and create row
version. `ensureCurrent` rejects all unexpected fields, including
`locationId`, date or timestamp fields, actor or user fields, role, status,
session ID, installation ID, patient or encounter IDs, force flags, and bypass
flags.

## Preload API

HSD-028B exposes exactly one screening-session group on the existing context-isolated preload bridge:

- `window.healthScreening.screeningSessions.getWorkspaceContext()`
- `window.healthScreening.screeningSessions.ensureCurrent()`
- `window.healthScreening.screeningSessions.create(request)`
- `window.healthScreening.screeningSessions.close(request)`
- `window.healthScreening.screeningSessions.reopen(request)`
- `window.healthScreening.screeningSessions.getById(request)`
- `window.healthScreening.screeningSessions.list(request)`

Each method invokes only its matching fixed channel from the table above.
`getWorkspaceContext()` and `ensureCurrent()` construct strict empty requests
inside preload; renderer code cannot provide request objects for those
operations. Other methods validate the renderer-supplied request with the
shared schema before invoking IPC and pass the parsed transport value, not the
original object.

Local request validation failures return `VALIDATION_FAILED` without invoking IPC. Invoke failures, rejected promises, malformed main-process responses, malformed failure envelopes, extra/internal response fields, invalid nested workspace or session data, and response parsing failures return only `IPC_UNAVAILABLE`.

Returned screening-session results are deeply frozen, including nested session records, workspace active-location arrays, active-location records, list item arrays, and list item records. The preload API group and root `window.healthScreening` object are frozen. The preload boundary does not freeze or mutate renderer-provided request objects.

The preload bridge does not expose `ipcRenderer`, `invoke`, `send`, `sendSync`, event objects, listener management, subscriptions, dynamic channel selection, MessagePorts, filesystem or shell APIs, Node built-ins, database objects, repositories, transaction contexts, clocks, or ID generators. HSD-028B adds no screening-session push subscription.

## Authentication And Authorization

Every handler validates the sender with the trusted main-frame policy before parsing the request. It then resolves the active session through the main-process authentication authorization adapter.

Allowed roles:

- `LOCAL_ADMIN`: context, ensure current, create, close, reopen, get, list
- `NURSE`: context, ensure current, create, close, reopen, get, list
- `TRAINED_SCREENER`: context, ensure current, create, close, get, list

The IPC handler passes only `{ userId, role }` from the authenticated main-process session to the application service. A trained screener's reopen request is denied at the authenticated handler boundary before request parsing or application-service invocation. HSD-027C retains its service-owned `FORBIDDEN` result as defense in depth for any authorized caller path that reaches the service.

## Workspace Context

`getWorkspaceContext` returns:

- `deploymentLocalDate`, calculated from the controlled UTC clock and stored installation IANA timezone;
- active locations ordered by the location repository;
- each location's `id` and display `name`.

The context does not return installation IDs, database timestamps, audit fields, normalized location names, inactive locations, repository metadata, or an active-location selection. HSD-029C-P0 supersedes temporary renderer location selection as operational authority by adding a trusted persisted configured-location service in the main process; this HSD-028B IPC context still persists nothing and is not the authority for future background daily-session resolution.

Invalid or missing installation/timezone state fails closed with a sanitized IPC error. The code never falls back to the operating-system timezone or UTC.

## Current Daily Session

`ensureCurrent` is the HSD-029C-P1 route-entry boundary for the Screening
workflow. The handler validates the trusted sender before parsing the empty
request, rejects unexpected positional arguments, resolves authentication and
authorization in the main process, calls the P0 configured-location resolver,
derives the operational local date from the stored installation timezone and
authoritative transaction clock, and returns only the sanitized service result.

Success statuses are:

- `RESOLVED`, for an existing reusable `OPEN` daily session;
- `CREATED`, for a newly inserted daily session.

Controlled statuses are:

- `AUTHENTICATION_REQUIRED`
- `FORBIDDEN`
- `LOCATION_NOT_CONFIGURED`
- `LOCATION_NOT_FOUND`
- `LOCATION_INACTIVE`
- `SESSION_CLOSED`
- `SESSION_CONFLICT`
- `NO_ACTIVE_PROTOCOL`
- `UNAVAILABLE`

The database uniqueness constraint
`ux_screening_sessions_location_date(location_id, session_date)` remains the
daily-session invariant. Expected uniqueness races are recovered by querying
the canonical row with the trusted configured location and authoritative local
date. Unrelated repository or SQLite failures are sanitized and do not cross IPC
as raw messages.

When a missing daily session is created, the existing session lifecycle service
policy writes one `SCREENING_SESSION_CREATED` audit event and one
`SCREENING_SESSION_CREATED` outbox row in the same transaction. Returning an
existing session, returning `SESSION_CLOSED`, recovering after a uniqueness
race, validation failure, authorization failure, location-resolution failure,
and rollback do not create duplicate audit or outbox rows.

The handler does not accept renderer location state, date state, session status,
actor, user ID, role, force flags, bypass flags, patient IDs, encounter IDs, or
clinical data. It does not create patient encounters, clinical records,
recommendations, referrals, reports, sync transport, or FHIR mappings. It never
opens the P0 administrative recovery or reconfiguration services.

## Public Session Data

Screening-session results expose:

- `id`
- `locationId`
- `protocolVersionId`
- `sessionDate`
- `status`
- `notes`
- `openedAt`
- `closedAt`
- `createdAt`
- `rowVersion`

`ensureCurrent` exposes the same minimum open-session identifiers and dates, a
sanitized configured-location display object for the header, and no notes.

They do not expose actor IDs, audit metadata, outbox payloads,
lifecycle-history IDs, installation IDs, normalized values, raw SQL, database
details, patient data, encounter data, clinical values, or internal
configuration records.

## Result Mapping

Expected HSD-027C lifecycle outcomes remain successful typed IPC data:

- ensure current: `RESOLVED`, `CREATED`, `AUTHENTICATION_REQUIRED`,
  `FORBIDDEN`, `LOCATION_NOT_CONFIGURED`, `LOCATION_NOT_FOUND`,
  `LOCATION_INACTIVE`, `SESSION_CLOSED`, `SESSION_CONFLICT`,
  `NO_ACTIVE_PROTOCOL`, `UNAVAILABLE`
- create: `CREATED`, `ALREADY_EXISTS`, `SESSION_DATE_NOT_CURRENT`, `LOCATION_NOT_FOUND`, `LOCATION_INACTIVE`, `NO_ACTIVE_PROTOCOL`
- close: `CLOSED`, `NOT_FOUND`, `SESSION_VERSION_CONFLICT`, `ALREADY_CLOSED`
- reopen: `REOPENED`, `NOT_FOUND`, `SESSION_VERSION_CONFLICT`, `ALREADY_OPEN`, `FORBIDDEN`
- get: `FOUND`, `NOT_FOUND`
- list: `LISTED`

Unexpected application, repository, database, timezone, malformed-output, or thrown failures map to fixed sanitized IPC failures.

## Sensitive Data

Handlers, contracts, and preload methods do not log or return SQL, database paths, raw SQLite messages, stack traces, causes, notes, reason text, complete IPC payloads, audit metadata, outbox payloads, unrelated identifiers, or clinical data. Operational logs contain only the channel, safe error code, and sanitized error type.

## Registration And Disposal

Application startup creates one production screening-session service and one workspace-context service from the existing database runtime. The same instances are reused for all screening-session handlers.

Registration uses fixed channels and deterministic disposal. Focused screening-session registration rejects a duplicate active registration with a fixed controlled error and leaves the original handlers in place. Each successful registration returns a disposer that owns only that exact registration; repeated calls are harmless, and a stale disposer cannot remove a newer registration on the same IPC main object. If a partial registration fails while Electron handlers are being installed, only the screening-session handlers installed by that failed attempt are removed. Disposal is idempotent, successful disposal removes only screening-session handlers, and unrelated app, first-run, authentication, patient, or external handlers remain untouched. Application-wide startup registration still preserves the existing app, first-run, authentication, and patient handler behavior.

## HSD-028C Boundary

## HSD-028C Renderer Workspace

HSD-028C adds the production renderer workspace on top of the fixed preload API. The workspace uses `window.healthScreening.screeningSessions` only; it does not import Electron, main-process services, repositories, database code, or dynamic channel names.

HSD-029C-P1 changes the Screening entry gate to call `ensureCurrent()` instead
of deriving operational authority from the workspace context. The renderer waits
for `RESOLVED` or `CREATED` before enabling patient-screening workflow context,
shows controlled states for authentication, authorization, location
configuration, closed-session, protocol, and temporary-unavailable outcomes,
and supports retry after `UNAVAILABLE`. Ordinary rerenders do not create
additional operational effects.

The active location ID and daily session returned by `ensureCurrent()` are
renderer workflow context, not new operational authority. They are not written
to localStorage, sessionStorage, IndexedDB, cookies, files, URLs, SQLite, or
another persistence mechanism. The renderer does not choose the session date,
select another location, assign or reconfigure the installation, reopen closed
sessions automatically, rewrite historical attribution, create encounters, or
perform clinical work.

The HSD-029C-P2 renderer now uses the ensured daily session only to gate patient
screening entry. It no longer renders a daily-session list, manual session
selection, manual session creation, close controls, or reopen controls in the
Screening workspace. Controlled `ensureCurrent` outcomes keep the Patients
workspace unavailable until `RESOLVED` or `CREATED` returns.

Once ready, the workspace searches patients through the existing patient preload
boundary and starts or resumes patient encounters through the approved
HSD-029A/HSD-029B encounter-start boundary. The renderer passes only
`patientId` and the sanitized P1 `screeningSessionId` to encounter start. It
does not infer audit or outbox state, does not create daily sessions directly,
and does not write the session context to browser storage.

The visible design follows the approved shell language: deep-navy top bar,
light-blue contextual commands, pale gray background, white bordered cards,
navy headings, teal interaction accents, compact desktop density, clickable
patient rows, and patient tabs. It is designed for the supported desktop range
of 1280x720, 1366x768, and 1920x1080.

HSD-029C-P2 does not implement an admin settings UI, clinical persistence,
measurements, protocol calculations, recommendations, referrals, reports,
dashboard counts, sync networking, push subscriptions, fake records, or
active-session persistence.

## HSD-029 Boundary

HSD-029A and HSD-029B introduced the reviewed encounter-start service and
IPC/preload boundary. HSD-029C-P2 uses that boundary from clickable patient
rows, preserves the approved authority checks, does not accept renderer-supplied
location authority, and does not introduce arbitrary IPC. P0 administrative
recovery remains separate for installations that return
`LOCATION_NOT_CONFIGURED`.
