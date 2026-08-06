# Screening Session IPC Boundary

HSD-028A exposes the HSD-027 screening-session application service through authenticated main-process IPC handlers. It adds shared renderer-safe contracts and fixed channels only. Preload methods, renderer workspace state, encounters, measurements, protocol calculation, referrals, reports, and sync transport remain outside this checkpoint.

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

## Authentication And Authorization

Every handler validates the sender with the trusted main-frame policy before parsing the request. It then resolves the active session through the main-process authentication authorization adapter.

Allowed roles:

- `LOCAL_ADMIN`: context, create, close, reopen, get, list
- `NURSE`: context, create, close, reopen, get, list
- `TRAINED_SCREENER`: context, create, close, get, list

The IPC handler passes only `{ userId, role }` from the authenticated main-process session to the application service. A trained screener's reopen request reaches the HSD-027C service and returns the service-owned `FORBIDDEN` business result.

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

Handlers and contracts do not log or return SQL, database paths, raw SQLite messages, stack traces, causes, notes, reason text, complete IPC payloads, audit metadata, outbox payloads, unrelated identifiers, or clinical data. Operational logs contain only the channel, safe error code, and sanitized error type.

## Registration And Disposal

Application startup creates one production screening-session service and one workspace-context service from the existing database runtime. The same instances are reused for all screening-session handlers.

Registration uses fixed channels and deterministic disposal. Re-registration first removes application-owned handlers, disposal is idempotent, and unrelated app, first-run, authentication, patient, or external handlers remain untouched.

## HSD-028B Boundary

HSD-028B may add preload methods and renderer workflows on top of these contracts. It must not add renderer-selected channel names, generic IPC dispatch, active-location persistence, fake dashboard counts, screening encounters, measurements, protocol calculations, referrals, reports, or sync transport.
