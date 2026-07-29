# Engineering Standards

HSD-002 keeps the application in an engineering-foundation state. Tooling may improve reliability, but it must not introduce clinical workflows, authentication, routing, business IPC, or synchronization. HSD-006 adds the trusted local SQLite runtime foundation. HSD-007 adds numbered migrations and an empty schema-v1 structure. HSD-008 adds main-process entity ID, UTC clock, and transaction boundaries. HSD-009 adds the first main-process typed installation repository and read-only first-run state query. HSD-010 adds a main-process-only asynchronous password credential primitive. HSD-011 adds a typed local-user repository and username identity boundary over the existing users table, but still does not add first-run setup, seed data, login, sessions, clinical workflows, IPC, renderer changes, or synchronization.

## TypeScript

TypeScript strictness is explicit for the Node-side and renderer-side projects:

- `strict`
- `noImplicitAny`
- `noUncheckedIndexedAccess`
- `noFallthroughCasesInSwitch`
- `noImplicitOverride`
- `forceConsistentCasingInFileNames`
- `useUnknownInCatchVariables`

The Electron Toolkit base config currently provides `skipLibCheck: true`; this project does not change that inherited framework setting in HSD-002.

## Import Boundaries

The application keeps Electron responsibilities separated by process:

- `src/main` owns trusted desktop behavior and future local data access.
- `src/preload` owns the narrow `contextBridge` API exposed to the renderer.
- `src/renderer` owns React presentation code only.
- `src/shared` owns process-neutral contracts and types.

Aliases are scoped by project:

- Main and preload TypeScript can resolve `@main/*`, `@preload/*`, and `@shared/*` when valid for their process.
- Renderer TypeScript can resolve `@renderer/*` and `@shared/*`.
- Vitest unit tests resolve `@shared/*`.

Renderer code cannot import Electron, Node built-ins, `src/main`, `src/preload`, `@main/*`, or `@preload/*`. ESLint enforces this boundary; renderer code must use the typed preload API exposed on `window.healthScreening`.

SQLite is owned only by `src/main/database`. The production database is a
file-backed `userData/data/health-screening.sqlite3` runtime and its path,
native handle, SQL, migration checksums, schema details, and raw errors must
never cross into shared, preload, or renderer code or operational logs. The
exact `better-sqlite3@13.0.2` dependency requires Electron-compatible native
rebuild and ASAR-unpack review before upgrades.

Password credential code is owned only by `src/main/security/password`. It may
use built-in Node `crypto` APIs but must not be imported by preload, renderer,
or shared IPC code, and must not import SQLite, repositories, or transaction
modules.

## Database Migrations

Released migration files are immutable. Do not edit, rename, reorder, squash, or
reuse a migration after review. Every later schema change must add a new
numbered SQL file and append one explicit manifest entry.

Migration versions must be positive, unique, ordered, and contiguous. SQL is
imported as `?raw` from the trusted main-process migration manifest; startup must
not scan directories or read repository-relative migration files.

Each migration runs in one SQLite transaction with its SQL body, ledger insert,
and `PRAGMA user_version` update committed together. Startup must refuse unsafe
history, checksum mismatches, inconsistent metadata, and newer databases. It
must never silently reset, downgrade, delete, replace, or auto-repair a
production database.

Every application table introduced by a migration must be `STRICT`. Booleans use
integer 0/1 checks, JSON text uses `json_valid` checks, and clinical or audit
relationships use restrict foreign keys rather than cascade deletes unless a
later approved task explicitly changes that rule.

## Database Transactions

Future write paths must use the main-process transaction executor from
`src/main/database/transaction`. Repository code must not open ad hoc
transactions, create savepoints, run async work inside a transaction callback, or
nest executor calls. Each accepted write boundary runs synchronously under
`BEGIN IMMEDIATE` and returns only after commit.

Entity IDs and UTC timestamps for local writes come from
`src/main/foundation`. Do not accept renderer-generated IDs or timestamps as
trusted values without main-process validation.

Transaction and foundation errors must remain controlled. Do not attach raw
native errors as causes, expose stacks, or log SQL text, bind values, row data,
checksums, database paths, or raw driver messages.

## Database Repositories

Repositories live only under `src/main/database/repositories` and must not be
imported by preload, renderer, or shared IPC code. Repository code owns exact SQL
and strict row decoders; use explicit column lists and never `SELECT *`.

Read methods may use the already-open main-process SQLite connection and must
perform no writes, repairs, cache mutation, schema changes, or default row
creation. Write methods must require the HSD-008 `DatabaseTransactionConnection`
from a caller-owned transaction callback. Repositories must not run transaction
control SQL, call `transaction()`, retry failures, or hide multi-table workflow
decisions inside repository methods.

Every value read from SQLite must be decoded from `unknown` through reviewed
domain parsers. Malformed persisted data fails closed with a controlled
data-integrity error rather than being treated as absent or repaired
automatically.

Repository errors must use fixed codes and messages. They may include only
reviewed technical `errorType` values and must not retain raw causes, stacks,
SQL, paths, row values, UUIDs, timestamps, deployment names, timezone values, or
SQLite messages. Repository code must not log.

Local user repositories must derive `username_normalized` internally from the
canonical username, use credential-free ordinary projections, and expose
credential text only through a separate main-process authentication projection.
They must accept only pre-derived HSD-010 `StoredPasswordCredential` values and
must never accept plaintext passwords, hash passwords, verify passwords, update
login counters, create sessions, or perform authorization.

## Password Credentials

Password derivation and verification must use the HSD-010 password credential
service under `src/main/security/password`. Production code must use
asynchronous Node `crypto.scrypt` with the reviewed frozen `scrypt-v1`
parameters and a fresh 32-byte salt from `randomBytes`; do not use
`scryptSync`, lower parameters, dependency-based KDFs, environment overrides, or
renderer-supplied crypto settings.

Password parsing preserves exact input. Do not trim, lowercase, case-fold,
Unicode-normalize, collapse whitespace, or add composition rules inside the
credential primitive. Leading/trailing spaces and composed/decomposed Unicode
sequences remain distinct credentials.

Hashing and verification return promises and must not run inside
`DatabaseTransactionExecutor.run()`. Later services must derive or verify
credentials before opening synchronous SQLite transactions, then re-check
workflow invariants inside the transaction.

Password modules must not log. Controlled password errors use fixed codes and
messages and must not retain plaintext, salts, password hashes, derived keys,
raw crypto messages, causes, stacks, paths, SQL, or input metadata. Mutable
password, salt, and key buffers should be zero-filled on a best-effort basis
after use.

The internal credential persistence validator may be imported only by reviewed
main-process repository code. It validates canonical stored credential text and
clears decoded buffers, but it must not be exported from application-facing
security barrels or used as a credential creation or verification API.

## Formatting And Linting

Prettier is the formatting authority.

- `pnpm format` writes formatting changes.
- `pnpm format:check` verifies formatting without modifying files.

ESLint enforces TypeScript, React hook, React refresh, and renderer-boundary rules. `pnpm lint` runs with `--max-warnings=0`, so warnings fail the quality gate.

## Tests

Unit tests live under `tests/unit` and use Vitest in a deterministic Node environment. Test files use the `*.test.ts` naming pattern.

Current unit tests cover shared IPC contracts, main-process sender policy, application IPC handlers, preload wrappers, and security regressions without launching Electron.

## Verification

Run the quality gate before handoff:

```powershell
pnpm verify
```

`pnpm verify` runs formatting check, lint, TypeScript checks, and unit tests. Production build remains separate:

```powershell
pnpm build
```

## Renderer CSP And Session Permissions

Development and production use different CSP delivery mechanisms. Development uses an Electron
`session.webRequest.onHeadersReceived` response header for the approved Vite renderer origin so
Vite HMR can use its exact same-port WebSocket connection. Production uses a Vite build-time HTML
transform that injects one CSP meta tag into the packaged renderer HTML.

The only development CSP exceptions are `style-src 'unsafe-inline'` for Vite style injection and
`connect-src 'self' <exact-websocket-origin>` for the configured loopback renderer port. Vite
React's development refresh preamble must be loaded as a same-origin external module, so
development script policy remains `script-src 'self'`. Development must not add script
`unsafe-inline`, `unsafe-eval`, broad `ws:` or `wss:` sources, wildcard hosts, or
all-localhost-port access.

Production currently has a no-network renderer policy: `connect-src 'none'`. Later backend or sync
connectivity must be added through a narrowly reviewed `connect-src` change for the exact required
origin; wildcard network access is not allowed.

Electron session permissions are denied by default through both permission-check and
permission-request handlers. Any future use of notifications, geolocation, media, clipboard,
display capture, USB, HID, serial, Bluetooth, or an unknown browser permission requires a later
reviewed task before it can be enabled.

After building, verify the packaged CSP output:

```powershell
Select-String -Path out/renderer/index.html -Pattern 'Content-Security-Policy' -AllMatches
Select-String -Path out/renderer/index.html -Pattern "unsafe-eval|unsafe-inline|connect-src[^;]*" -AllMatches
```

## Typed IPC And Preload Bridge

HSD-005 permits exactly two renderer-to-main operations:

- `app.getInfo()` on `health-screening:app:get-info` with request `{}` and safe
  metadata response `{ applicationName, applicationVersion, platform, architecture, packaged }`.
- `app.getHealth()` on `health-screening:app:get-health` with request `{}` and
  shell-health response `{ status: 'ready', ipc: 'available', database: 'ready' | 'unavailable', clinicalFeatures: 'not-implemented' }`.

All IPC request, response, and result schemas live under `src/shared/ipc`.
Schemas are authoritative and TypeScript types are inferred from them. Runtime
validation is required in main before trusted execution, in main before success
return, and in preload before renderer delivery.

Every main handler validates `event.senderFrame`, requires the sender to be the
WebContents main frame, and authorizes the frame URL through the same HSD-003
`NavigationPolicy` used by the main window. Do not authorize by channel name,
process ID, a development boolean, or the existence of a BrowserWindow.

The renderer receives only `window.healthScreening.app.getInfo` and
`window.healthScreening.app.getHealth`. Do not expose raw `ipcRenderer`, generic
`invoke` or `send` wrappers, synchronous IPC, event objects, arbitrary channels,
Node globals, filesystem APIs, `process`, `Buffer`, or `require`.

IPC handlers are registered after session security configuration and before
renderer loading. Registration must dispose and replace only the application
owned HSD-005 handlers so tests, reloads, or lifecycle recovery cannot
accumulate duplicates.

Future IPC operations require a threat review, one namespaced channel, strict
schemas, sender authorization, a main handler, one explicit preload method,
documentation, and tests. When authentication exists, role authorization must be
reviewed before exposing the operation.

Do not log IPC payloads or expose technical failures to the renderer. Logs may
include channel name, safe error code, and exception type only. Renderer-visible
errors must use the typed result envelope and stable safe messages.
