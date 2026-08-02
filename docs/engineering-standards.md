# Engineering Standards

HSD-002 keeps the application in an engineering-foundation state. Tooling may improve reliability, but it must not introduce clinical workflows, authentication, routing, business IPC, or synchronization. HSD-006 adds the trusted local SQLite runtime foundation. HSD-007 adds numbered migrations and an empty schema-v1 structure. HSD-008 adds main-process entity ID, UTC clock, and transaction boundaries. HSD-009 adds the first main-process typed installation repository and read-only first-run state query. HSD-010 adds a main-process-only asynchronous password credential primitive. HSD-011 adds a typed local-user repository and username identity boundary over the existing users table. HSD-012 adds a typed location repository and location identity boundary over the existing locations table. HSD-013 adds a typed append-only audit-event repository and canonical metadata boundary over the existing audit log table. HSD-014 adds the main-process first-run bootstrap application service that composes approved repositories atomically. HSD-015 exposes that service through trusted first-run IPC and preload contracts, but still does not add first-run UI, startup writes, login, sessions, clinical workflows, protocol setup, settings writes, or synchronization.
HSD-016 adds the renderer-owned first-run setup flow. The renderer may consume
only `app.getInfo()`, `app.getHealth()`, `firstRun.getState()`, and
`firstRun.initialize()` through `window.healthScreening`; it must not add new
IPC channels, preload capabilities, startup writes, login, sessions, protocol
setup, settings writes, or clinical workflows.
HSD-017 adds a main-process-only local-user authentication-state repository
mutation. It persists caller-approved failed-login, lock, last-login, and
updated timestamps through compare-and-set inside an existing transaction, but
does not add password verification, lockout policy, audit events, sessions, IPC,
preload, renderer login, or clinical behavior.
HSD-018 adds a main-process-only local login authentication service. It verifies
real or dummy credentials outside SQLite transactions, applies the fixed
five-attempt and 15-minute lockout policy, revalidates observations inside the
transaction, persists state through the HSD-017 compare-and-set boundary, and
appends exactly one security audit event. It does not add sessions, IPC,
preload, renderer login, authorization, password change/reset, schema
migrations, or clinical workflows.
HSD-019 adds a main-process-only local-user credential-state repository
mutation. It persists pre-derived stored credentials and `mustChangePassword`
through compare-and-set inside an existing transaction, but does not add
plaintext password handling, password hashing, password policy, forced
password-change services, audit events, sessions, IPC, preload, renderer login,
or clinical behavior.
HSD-020 adds the main-process-only forced password-change application service.
It validates hostile commands, verifies current and replacement-password reuse
outside SQLite transactions, hashes the replacement credential before opening a
transaction, validates the replacement through the public password credential
service boundary, revalidates authoritative user state inside the transaction,
persists HSD-017 authentication-state reset and HSD-019 credential rotation
atomically, and appends exactly one security audit event. It does not add
sessions, IPC, preload, renderer login, migrations, password reset, voluntary
password change, or clinical behavior.
HSD-021 adds the main-process-only local authentication session service. It
keeps exactly one credential-free in-memory context, coordinates HSD-018 login
and HSD-020 forced password change, enforces fixed idle/provisional/absolute
deadlines lazily through one UTC clock, supports manual lock, same-user unlock,
logout, stale async result cancellation, and role authorization. It does not add
session persistence, migrations, IPC, preload, renderer UI, background timers,
new audit action codes, password reset, voluntary password change, or clinical
authorization policy beyond role membership.
HSD-022 exposes that session service through fixed authenticated IPC, a narrow
preload `auth` group, validated session-change events, and a pure renderer
authentication route controller. It does not add complete login,
password-change, unlock, or clinical shell UI, and it must not add persistent
sessions, tokens, cookies, browser storage, migrations, background timers, or
generic IPC.
HSD-023 completes the renderer-visible login, required password-change, locked
session, and authenticated shell experience on top of the HSD-022 preload API.
It keeps credentials in uncontrolled form controls only, uses exact typed
preload requests, observes public deadlines and user activity only as advisory
session prompts, and adds no IPC, preload, main-process services, database
writes, migrations, session persistence, network behavior, synchronization, or
clinical workflows.
HSD-024 replaces the active-session foundation view with a renderer-only
application shell. It may use already-loaded startup metadata and the public
active-session user to render role-visible primary menus, contextual commands,
an honest dashboard, and transparent planned-module routes. It adds no IPC,
preload methods, main-process services, database reads, migrations, clinical
records, patient tabs, synchronization, backup, network behavior, browser
routing, or browser persistence.

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

Renderer first-run setup code must treat the preload bridge as the only desktop
capability. It must not use browser persistence (`localStorage`,
`sessionStorage`, IndexedDB, cookies, URLs, or files), network APIs, dynamic
channels, direct Electron access, direct Node access, or shared mutable setup
state. Renderer-visible setup errors must use fixed local guidance and must not
display raw error messages, exception names, stacks, SQL, paths, IDs,
timestamps, audit data, request serialization, or credential material.

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

Main-process application services live under `src/main/application`. They may
compose reviewed main-process repositories, transaction executors, foundation
providers, and security services, but they must not expose raw SQLite handles,
SQL, transaction contexts, credentials, or dependency references to preload,
renderer, shared IPC, or logs.

Application authentication services own login decision policy, expected
rejection results, forced password-change workflow decisions, transaction-time
revalidation, session state, and security audit classification. They may use
credential-bearing repository projections only inside the main process and must
return credential-free records, fixed rejection reasons, or frozen session
snapshots. HSD-021 is the reviewed boundary for in-memory session management and
role authorization. HSD-022 may expose only minimized public session data
through authenticated IPC and preload. Authentication services and IPC handlers
must not persist sessions or trust renderer-supplied user IDs, roles, session
tokens, revisions, or timestamps.

Renderer authentication code may render login, required password-change, unlock,
lock, sign-out, and active-shell controls only through the reviewed preload
`auth` methods. It must not store credentials in React state, contexts, reducers,
browser persistence, logs, URLs, or snapshots. Renderer activity and deadline
helpers must ask HSD-021 to observe the session; they must not recreate expiry,
authorization, login, unlock, or password-change policy in the renderer.

Renderer application navigation must keep menu and command identifiers as
closed TypeScript unions backed by a frozen catalog. Role-visible menu filtering
is display logic only and must never be sent to main as authorization input.
Dashboard cards must show unavailable values rather than invented counts, dates,
site names, session names, sync totals, or backup timestamps. Planned modules
must route to an explicit unavailable-in-this-build workspace and must not
render forms, tables with sample rows, enabled clinical actions, or fake
results. Shell route state must remain volatile React/controller state only; do
not store it in URLs, browser history, `localStorage`, `sessionStorage`,
IndexedDB, cookies, Cache API, files, or window names.

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

Application services that need asynchronous preparation, such as password
hashing, must complete that work before entering `DatabaseTransactionExecutor.run()`.
They must then re-check workflow invariants inside the synchronous callback
before writing. No promise, thenable, random byte generation, scrypt work, file
I/O, IPC, timer, or network operation belongs inside a transaction callback.

Local login follows the same rule: password verification, including dummy
verification for unknown usernames, completes before the transaction opens. The
transaction callback only revalidates the authoritative installation and user
observation, mutates authentication state through the HSD-017 repository method
when needed, and inserts the corresponding audit event.

Credential rotation follows the same rule. Password hashing must complete
before the transaction opens. Forced password change follows that boundary by
verifying the current password, checking replacement-password reuse, and hashing
the replacement credential before the transaction opens. Replacement credential
validation, exact credential comparison, and replacement verification also
complete before the transaction opens. The transaction callback may only
revalidate authoritative state, use HSD-017 and HSD-019 compare-and-set
mutations with exact expected snapshots, and append the audit event.

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
They must accept only pre-derived HSD-010 `StoredPasswordCredential` values.
Authentication-state mutations may update only `failed_login_count`,
`locked_until`, `last_login_at`, and `updated_at` through a caller-owned
transaction-scoped compare-and-set operation. Credential-state mutations may
update only `password_hash`, `password_salt`, `must_change_password`, and
`updated_at` through a caller-owned transaction-scoped compare-and-set
operation. Local-user repositories must never accept plaintext passwords, hash
passwords, verify passwords, decide lockout policy, compose audit events, create
sessions, or perform authorization.

Location repositories must derive `name_normalized` internally from the
canonical location name, allow duplicate display names and duplicate normalized
keys, and use deterministic `name_normalized, id` ordering for list reads. They
must require authentic HSD-008 transaction capabilities for writes, set active
and update provenance defaults internally, and fail closed on noncanonical
persisted location names or optional geography text.

Audit event repositories must be append-only and must never update, delete,
redact, repair, emit, or recursively audit events. They must require authentic
HSD-008 transaction capabilities before validating or writing, keep installation
and optional user references SQLite-enforced, and decode rows and lists from
unknown values with strict descriptor checks.

Audit metadata must be copied into a new bounded graph, sorted
lexicographically by object key, serialized deterministically, checked against
the 4,096 byte canonical JSON limit, and deep-frozen before returning records.
Metadata validation is a shape, size, and inert-text boundary; it is not a PHI
or sensitive-content detector, and audit metadata must never be logged or
included in controlled errors.

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

`PasswordCredentialService.validateCredential()` is the public security-layer
boundary for unknown already-derived credential values that application services
must inspect before persistence. It strictly validates canonical credential
shape and encoding, returns a new frozen credential copy, clears decoded buffers,
and has no repository, persistence, hashing, or verification responsibility.

Password modules must not log. Controlled password errors use fixed codes and
messages and must not retain plaintext, salts, password hashes, derived keys,
raw crypto messages, causes, stacks, paths, SQL, or input metadata. Mutable
password, salt, and key buffers should be zero-filled on a best-effort basis
after use.

The internal credential persistence validator may be imported only by reviewed
main-process repository code. It validates canonical stored credential text and
clears decoded buffers, but it must not be exported from application-facing
security barrels or used as an application-service credential validation,
creation, or verification API. HSD-019 local-user credential-state writes use
this validator only for pre-derived stored credentials. HSD-020 forced password
change derives and validates replacement credentials through the password
credential service before the transaction and audits credential rotation at the
application-service boundary.

First-run bootstrap services must minimize credential exposure. A temporary
administrator password may be passed only to the HSD-010 password credential
service, and the resulting stored credential may be passed only into the
local-user repository write input. Bootstrap results, audit metadata, errors,
logs, IPC contracts, and renderer-facing values must not include plaintext,
hashes, salts, derived keys, or credential objects.

Local login services must minimize credential exposure in the same way.
Plaintext passwords remain function-local and are passed only to
`PasswordCredentialService.verify()`. The production login service creates one
private dummy credential during composition. Login results, audit metadata,
errors, logs, IPC contracts, and renderer-facing values must not include
plaintext, hashes, salts, derived keys, dummy credentials, or credential-bearing
authentication projections.

Forced password-change services must minimize credential exposure in the same
way. Current and replacement plaintext passwords remain function-local and are
passed only to password verification, reuse verification, or replacement
hashing. Password-change results, audit metadata, errors, logs, IPC contracts,
and renderer-facing values must not include plaintext, hashes, salts, derived
keys, or credential-bearing authentication projections.

Local authentication session services must store only credential-free
`LocalUserRecord` copies and session timestamps in memory. Session snapshots,
authorization contexts, errors, logs, IPC contracts, and renderer-facing values
must not include plaintext, password hashes, salts, stored credentials,
credential-bearing projections, database handles, repository objects, audit
metadata, or bearer tokens.

## Formatting And Linting

Prettier is the formatting authority.

- `pnpm format` writes formatting changes.
- `pnpm format:check` verifies formatting without modifying files.

ESLint enforces TypeScript, React hook, React refresh, and renderer-boundary rules. `pnpm lint` runs with `--max-warnings=0`, so warnings fail the quality gate.

## Tests

Unit tests live under `tests/unit` and use Vitest in a deterministic Node
environment. Test files use the `*.test.ts` or `*.test.tsx` naming pattern.

Current unit tests cover shared IPC contracts, main-process sender policy,
application IPC handlers, preload wrappers, renderer authentication helpers, and
security regressions without launching Electron.

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

HSD-005 permits two shell renderer-to-main operations:

- `app.getInfo()` on `health-screening:app:get-info` with request `{}` and safe
  metadata response `{ applicationName, applicationVersion, platform, architecture, packaged }`.
- `app.getHealth()` on `health-screening:app:get-health` with request `{}` and
  shell-health response `{ status: 'ready', ipc: 'available', database: 'ready' | 'unavailable', clinicalFeatures: 'not-implemented' }`.

HSD-015 permits two first-run operations:

- `firstRun.getState()` on `health-screening:first-run:get-state` with request
  `{}` and minimized setup state.
- `firstRun.initialize(command)` on
  `health-screening:first-run:initialize` with a strict first-run command and
  minimized initialized state.

All IPC request, response, and result schemas live under `src/shared/ipc`.
Schemas are authoritative and TypeScript types are inferred from them. Runtime
validation is required in main before trusted execution, in main before success
return, and in preload before renderer delivery.

Every main handler validates `event.senderFrame`, requires the sender to be the
WebContents main frame, and authorizes the frame URL through the same HSD-003
`NavigationPolicy` used by the main window. Do not authorize by channel name,
process ID, a development boolean, or the existence of a BrowserWindow.

The renderer receives only `window.healthScreening.app.getInfo`,
`window.healthScreening.app.getHealth`,
`window.healthScreening.firstRun.getState`, and
`window.healthScreening.firstRun.initialize`, plus the fixed
`window.healthScreening.auth` methods from HSD-022. Do not expose raw
`ipcRenderer`, generic `invoke` or `send` wrappers, synchronous IPC, event
objects, arbitrary channels, Node globals, filesystem APIs, `process`,
`Buffer`, or `require`.

IPC handlers are registered after session security configuration and before
renderer loading. Registration must dispose and replace only the application
owned HSD-005 handlers so tests, reloads, or lifecycle recovery cannot
accumulate duplicates.

Future IPC operations require a threat review, one namespaced channel, strict
schemas, sender authorization, a main handler, one explicit preload method,
documentation, and tests. When authentication exists, role authorization must be
reviewed before exposing the operation.

Do not log IPC payloads or expose technical failures to the renderer. Logs may
include channel name, safe error code, and allowlisted technical exception type
only. Renderer-visible errors must use the typed result envelope and stable safe
messages.
