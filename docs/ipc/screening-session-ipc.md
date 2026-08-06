# Screening Session IPC Boundary

HSD-028A exposes the HSD-027 screening-session application service through authenticated main-process IPC handlers. HSD-028B exposes those fixed channels through the validated `window.healthScreening.screeningSessions` preload group. Renderer workspace state, encounters, measurements, protocol calculation, referrals, reports, and sync transport remain outside these checkpoints.

## Channels

| Operation                               | Channel                                                     | Request                                                    |
| --------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `screeningSessions.getWorkspaceContext` | `health-screening:screening-sessions:get-workspace-context` | `{}`                                                       |
| `screeningSessions.create`              | `health-screening:screening-sessions:create`                | `{ locationId, sessionDate, notes? }`                      |
| `screeningSessions.close`               | `health-screening:screening-sessions:close`                 | `{ id, expectedRowVersion, reason? }`                      |
| `screeningSessions.reopen`              | `health-screening:screening-sessions:reopen`                | `{ id, expectedRowVersion, reason }`                       |
| `screeningSessions.getById`             | `health-screening:screening-sessions:get-by-id`             | `{ id }`                                                   |
| `screeningSessions.list`                | `health-screening:screening-sessions:list`                  | `{ locationId, status, dateFrom, dateTo, page, pageSize }` |

Requests are strict own-property objects. They reject renderer-supplied actor IDs, roles, protocol versions during creation, generated IDs, timestamps, lifecycle-history data, audit data, outbox data, create status, and create row version.

## Preload API

HSD-028B exposes exactly one screening-session group on the existing context-isolated preload bridge:

- `window.healthScreening.screeningSessions.getWorkspaceContext()`
- `window.healthScreening.screeningSessions.create(request)`
- `window.healthScreening.screeningSessions.close(request)`
- `window.healthScreening.screeningSessions.reopen(request)`
- `window.healthScreening.screeningSessions.getById(request)`
- `window.healthScreening.screeningSessions.list(request)`

Each method invokes only its matching fixed channel from the table above. `getWorkspaceContext()` constructs the strict empty request inside preload; renderer code cannot provide a request object for that operation. Other methods validate the renderer-supplied request with the shared HSD-028A schema before invoking IPC and pass the parsed transport value, not the original object.

Local request validation failures return `VALIDATION_FAILED` without invoking IPC. Invoke failures, rejected promises, malformed main-process responses, malformed failure envelopes, extra/internal response fields, invalid nested workspace or session data, and response parsing failures return only `IPC_UNAVAILABLE`.

Returned screening-session results are deeply frozen, including nested session records, workspace active-location arrays, active-location records, list item arrays, and list item records. The preload API group and root `window.healthScreening` object are frozen. The preload boundary does not freeze or mutate renderer-provided request objects.

The preload bridge does not expose `ipcRenderer`, `invoke`, `send`, `sendSync`, event objects, listener management, subscriptions, dynamic channel selection, MessagePorts, filesystem or shell APIs, Node built-ins, database objects, repositories, transaction contexts, clocks, or ID generators. HSD-028B adds no screening-session push subscription.

## Authentication And Authorization

Every handler validates the sender with the trusted main-frame policy before parsing the request. It then resolves the active session through the main-process authentication authorization adapter.

Allowed roles:

- `LOCAL_ADMIN`: context, create, close, reopen, get, list
- `NURSE`: context, create, close, reopen, get, list
- `TRAINED_SCREENER`: context, create, close, get, list

The IPC handler passes only `{ userId, role }` from the authenticated main-process session to the application service. A trained screener's reopen request is denied at the authenticated handler boundary before request parsing or application-service invocation. HSD-027C retains its service-owned `FORBIDDEN` result as defense in depth for any authorized caller path that reaches the service.

## Workspace Context

`getWorkspaceContext` returns:

- `deploymentLocalDate`, calculated from the controlled UTC clock and stored installation IANA timezone;
- active locations ordered by the location repository;
- each location's `id` and display `name`.

The context does not return installation IDs, database timestamps, audit fields, normalized location names, inactive locations, repository metadata, or an active-location selection. Future renderer state may keep a selection in memory, but this checkpoint persists nothing.

Invalid or missing installation/timezone state fails closed with a sanitized IPC error. The code never falls back to the operating-system timezone or UTC.

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

They do not expose actor IDs, audit metadata, outbox payloads, lifecycle-history IDs, installation IDs, normalized values, raw SQL, or database details. Display-name resolution beyond the workspace context is deferred to the renderer checkpoint unless an approved service boundary provides it.

## Result Mapping

Expected HSD-027C lifecycle outcomes remain successful typed IPC data:

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

HSD-028C may add renderer workspace state and UI on top of these preload methods. It must not add renderer-selected channel names, generic IPC dispatch, active-location persistence, fake dashboard counts, screening encounters, measurements, protocol calculations, referrals, reports, or sync transport.
