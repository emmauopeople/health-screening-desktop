# First-Run IPC Boundary

HSD-015 exposes the HSD-014 first-run bootstrap service through a narrow trusted
IPC and preload boundary. It adds renderer-callable setup operations, but it
does not add first-run UI, startup writes, login, sessions, authorization,
clinical workflows, settings writes, protocol setup, sync, backup, restore, or
printing.

## Channels

The channel catalog lives in `src/shared/ipc/channels.ts`.

| Operation                      | Channel                                 | Request                         | Success data                                                                                                           |
| ------------------------------ | --------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `firstRun.getState()`          | `health-screening:first-run:get-state`  | `{}` strict empty object        | `{ status: 'REQUIRED' }`, `{ status: 'INITIALIZED', deploymentName, timeZone }`, or `{ status: 'INCONSISTENT', code }` |
| `firstRun.initialize(command)` | `health-screening:first-run:initialize` | Strict first-run command object | `{ status: 'INITIALIZED', deploymentName, timeZone }`                                                                  |

Renderer-facing state is intentionally minimized. It never includes user IDs,
location IDs, audit IDs, timestamps, usernames, display names, location names,
geography, directions, passwords, hashes, salts, audit actions, metadata, SQL,
database paths, transaction details, or raw service results.

## Shared Contracts

All first-run IPC schemas live in `src/shared/ipc/first-run-contracts.ts` and
are safe for main, preload, renderer, and tests. Shared contracts do not import
Electron, Node built-ins, `better-sqlite3`, main-process repositories,
application services, or password modules.

Requests are strict own-property objects. Symbol properties, extra fields,
unknown location types, malformed nested objects, and oversized strings are
rejected before trusted execution. The schemas preserve input text exactly and
do not trim, normalize, repair, derive IDs, or derive timestamps.

All responses use the shared discriminated result envelope. Failure envelopes
contain only fixed safe codes and fixed safe messages. They do not carry
exception names, stacks, causes, SQL, paths, request data, credential material,
row data, or metadata.

## Sender Validation

Main-process first-run handlers validate the IPC sender before request parsing
or service invocation. The sender must be the WebContents main frame and its URL
must pass the same navigation policy used by the main window.

A forbidden sender receives `IPC_FORBIDDEN`. Hostile request objects are not
parsed for forbidden senders, so proxy traps and malformed payloads cannot run
before sender authorization.

## Handler Mapping

`getState` maps trusted service state into the public state shape and validates
the minimized output before returning it.

`initialize` validates the request, calls the HSD-014 service, maps the service
result into the public initialized state, and validates the minimized output
before returning it.

The reviewed renderer-visible initialize failure codes are:

- `VALIDATION_FAILED`
- `IPC_FORBIDDEN`
- `IPC_UNAVAILABLE`
- `INTERNAL_ERROR`
- `FIRST_RUN_ALREADY_INITIALIZED`
- `FIRST_RUN_STATE_INTEGRITY`
- `FIRST_RUN_INITIALIZATION_IN_PROGRESS`
- `FIRST_RUN_INITIALIZATION_FAILED`

Operational logs may include only the fixed event text, channel, safe error
code, and allowlisted technical error type. They must not include request
payloads, usernames, passwords, hashes, salts, location text, deployment names,
timezones, UUIDs, timestamps, SQL, paths, raw driver messages, metadata, stacks,
or causes.

## Preload Surface

The preload bridge exposes only:

```ts
window.healthScreening.app.getInfo()
window.healthScreening.app.getHealth()
window.healthScreening.firstRun.getState()
window.healthScreening.firstRun.initialize(command)
```

The root bridge object and nested groups are frozen. Preload does not expose
`ipcRenderer`, generic `invoke` or `send`, dynamic channel selection, Electron
events, Node globals, filesystem APIs, `process`, `Buffer`, or `require`.

Preload validates first-run requests before invoking main and validates main
responses before delivering them to the renderer. Invalid local requests map to
`VALIDATION_FAILED`; invoke failures or unreadable envelopes map to
`IPC_UNAVAILABLE`.

## Lifecycle

Production composition creates the first-run bootstrap service after database
runtime initialization and registers the IPC handlers before the main window is
loaded. Startup composition does not call `getState()` or `initialize()` and
does not write first-run rows.

The HSD-014 service remains the only place where repositories, password
hashing, audit writes, and transactions are coordinated. The IPC layer does not
open transactions, issue SQL, serialize credentials, create users, create
locations, emit audits directly, retry failures, or start nested workflows.
