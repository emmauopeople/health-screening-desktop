# Repository Structure

This repository separates Electron process responsibilities so trusted application logic stays outside the renderer.

## Root

- `electron.vite.config.ts` configures the Electron main, preload, and React renderer builds.
- `package.json` defines the pnpm scripts and baseline Electron dependencies.
- `tsconfig.json`, `tsconfig.node.json`, and `tsconfig.web.json` keep TypeScript settings process-aware.

## Main Process

`src/main` owns trusted desktop application behavior. Future work will place application lifecycle code, local configuration, database access, protocol logic, printing, logging, security, and sync/backup orchestration here.

`src/main/application` owns main-process application-service use cases that
compose reviewed lower-level contracts. HSD-014 adds the first-run bootstrap
service here. It sequences installation, local-user, location, and audit writes
through one caller-owned HSD-008 transaction after asynchronous password
hashing. HSD-015 adds production composition for this service so IPC handlers
can call it after database initialization, without invoking setup at startup or
adding renderer UI, login, sessions, authorization, protocol setup, settings
writes, or clinical behavior. HSD-018 adds `application/authentication`, a
main-process-only local login service that verifies credentials, applies
lockout policy, revalidates state, persists authentication outcomes, and audits
the attempt without exposing IPC, preload, renderer login, sessions,
authorization, or password-change behavior. HSD-020 adds the forced
password-change application service in the same folder; it verifies the current
password, rejects reused replacements, rotates credentials atomically, and
audits the finalized outcome without exposing IPC, preload, renderer UI,
session management, or authorization. HSD-021 adds
`application/authentication/session`, an in-memory main-process session service
that coordinates local login and forced password change, enforces idle lock,
same-user unlock, logout, stale-result cancellation, and role authorization
without adding IPC, preload, renderer code, migrations, or persistent sessions.
HSD-022 exposes that service through `src/main/ipc/authentication`, which owns
authenticated handler mapping, safe auth IPC errors, a scoped session publisher,
and the main-only authorization adapter for future protected business handlers.
HSD-029A adds `application/screening-encounters`, a main-process-only start
service that creates or retrieves the canonical root `DRAFT` encounter for an
eligible patient in an eligible current open screening session. It coordinates
patient/session/location eligibility, authorization, audit, and sync-outbox
writes in one transaction without adding IPC, preload, renderer, measurement,
completion, amendment, referral, reporting, or sync-transport behavior.

`src/main/foundation` owns main-process-only primitives for local data writes,
including validated UUID v4 entity IDs and UTC timestamps. These providers are
injectable for tests but are not shared with preload or renderer code.

`src/main/database` owns the single main-process SQLite runtime. It resolves the
userData-based database path, applies startup pragmas, runs numbered migrations,
reports live health, and closes the connection during application shutdown. It
does not expose SQL, migration checksums, schema details, database handles, or
paths to shared, preload, or renderer code.

`src/main/database/migrations` contains the main-process-only migration
contracts, checksum canonicalization, manifest validation, production migration
runner, and `sql/` directory. SQL files are imported as raw bundled assets; the
application must not discover migrations by scanning runtime directories.
HSD-029A-DB adds schema version 5, which enforces one root screening encounter
per patient per screening session through
`ux_screening_encounters_root_session_patient` while preserving future
amendment rows that reference a root encounter.

`src/main/database/transaction` contains the synchronous write transaction
executor. Future repositories must use this boundary for `BEGIN IMMEDIATE`,
commit, rollback, entity ID, and UTC timestamp coordination.

`src/main/database/repositories` contains main-process-only repository
boundaries. HSD-009 adds the typed installation repository and read-only
installation state query over schema version 1. HSD-011 adds the typed
local-user repository over the existing schema-v1 `users` table. HSD-017 adds
the local-user authentication-state compare-and-set mutation boundary without
adding login, lockout policy, sessions, IPC, or renderer behavior. HSD-019 adds
the local-user credential-state compare-and-set mutation boundary without
adding plaintext password handling, password hashing, forced password-change
workflow, audit events, sessions, IPC, or renderer behavior; HSD-020 composes
that repository method only from the application layer. HSD-012 adds the typed
location repository over the existing schema-v1 `locations` table. HSD-013 adds
the typed append-only audit-event repository over the existing schema-v1
`audit_log` table. Repositories own exact SQL and row decoding, while writes
use caller-owned transaction-scoped capabilities.
HSD-029A adds a focused screening-encounter repository boundary over
`screening_encounters` plus a minimal screening-encounter outbox writer. It can
read by encounter ID, find the canonical root by patient/session, and insert a
root `DRAFT` encounter using the schema-version-5 identity constraint as the
final concurrency safeguard. It does not add generic updates, reporting,
measurement, amendment, completion, void, IPC, preload, or renderer behavior.

`src/main/security/password` owns the HSD-010 local password credential
primitive. It validates exact plaintext password input, serializes strict
`scrypt-v1` credentials, wraps Node `crypto` password operations, and exposes no
IPC, preload, renderer, login, session, or user-repository behavior. HSD-011
adds a narrow internal persistence-validation bridge in this folder so
repositories can validate canonical credential text without exposing low-level
credential constructors or decoders through application-facing barrels.
HSD-019 uses that bridge for credential-state persistence only. HSD-020 uses
the application-facing password credential service for current-password
verification, replacement reuse checks, replacement hashing, and replacement
credential validation before transactional credential rotation. HSD-021 stores
no password credential material in session state.

The renderer must not import from `src/main`.

## Preload Process

`src/preload` exposes a narrow typed bridge through `contextBridge`. HSD-005
exposes fixed asynchronous application metadata and shell-health methods.
HSD-015 adds fixed first-run state and initialization methods. HSD-022 adds a
fixed `auth` method group and validated session-change subscription. HSD-028B
adds a fixed `screeningSessions` method group that validates screening-session
requests before IPC invocation, validates main-process responses before
renderer delivery, deeply freezes returned screening-session results, and adds
no push subscriptions. HSD-029B adds a fixed `screeningEncounters.start`
method that accepts only patient and screening-session IDs, validates responses,
and adds no lookup, mutation, measurement, referral, or push APIs. Preload does
not expose raw `ipcRenderer`, generic send/execute APIs, Electron event
objects, filesystem access, shell access, or dynamic channel dispatch.

## Renderer

`src/renderer` contains the React presentation layer. `src/renderer/index.html` is the renderer shell, and `src/renderer/src` contains UI code, feature folders, routes, stores, and styles.

`src/renderer/src/app/first-run` owns the HSD-016 renderer startup gate,
first-run setup form, safe setup state screens, and pure form/controller
helpers. These files depend only on renderer code and shared IPC types. They do
not own persistence, IPC channels, preload exposure, database access,
repository access, login, sessions, protocol activation, or clinical
workflows.

Renderer code should treat preload APIs as the only trusted bridge to desktop capabilities.

`src/renderer/src/app/authentication` owns the HSD-022 post-setup
authentication route controller and the HSD-023 renderer authentication
experience. It contains route mapping, uncontrolled login/password-change/unlock
forms, safe message mapping, public role labels, advisory deadline/activity
runtime helpers, and the thin authenticated-shell adapter that preserves lock
and sign-out behavior. It consumes only shared IPC types and the typed preload
API; it does not own persistence, dynamic IPC, Electron access, database access,
password modules, network behavior, synchronization, or clinical workflows.

`src/renderer/src/app/shell` owns the HSD-024 authenticated application shell.
It contains the frozen role-visible navigation catalog, renderer-only shell
controller, keyboard focus helpers, primary top bar, contextual command panel,
dashboard workspace, and transparent planned-module workspace. It receives only
safe startup metadata and public authenticated user data. It does not introduce
IPC, preload methods, browser routing, browser persistence, clinical records,
patient tabs, database access, network behavior, or authorization decisions.
HSD-025 owns patient search, duplicate review, four-patient tabs, and
unsaved-change guards.

`src/renderer/src/app/screening` owns the HSD-028C screening-session workspace
and the HSD-029C screening encounter-start workspace. It consumes only the
validated screening-session, screening-encounter, and patient-search preload
groups. Session-management state, patient tabs, active visual step, selected
patient, and selected session are renderer-memory state only. The HSD-029C
workspace may start or resume an encounter through
`screeningEncounters.start({ patientId, screeningSessionId })`; it does not
persist clinical fields, calculate protocol recommendations, import
Electron/main/preload modules, access SQLite, create fake records, generate
encounter IDs, add browser storage, implement referrals, dashboards, sync
transport, or networking.

## Shared Contracts

`src/shared` contains process-neutral TypeScript contracts, schemas, enums, errors, and types. These files may be imported by main, preload, renderer, and tests when the contract is safe to share across process boundaries.

Shared files must not depend on Electron, Node-only APIs, browser globals, or process-specific implementation details.

## Resources

`resources` stores application resources that are not source code, including future protocol definitions, print templates, seed data, and app assets.

## Build

`build` stores packaging/build assets generated or consumed by Electron tooling. Windows installer-specific assets belong in `build/installer-assets`.

## Documentation

`docs` stores architecture notes and implementation documentation. Architecture decision records belong in `docs/adr`. Application-service documentation belongs under `docs/application`. Database runtime, migration, schema, transaction, and repository-boundary documentation belongs under `docs/database`. Security implementation notes belong under `docs/security`.
IPC documentation belongs under `docs/ipc`, and renderer route-state and
authentication-experience documentation belongs under `docs/renderer`.

## Tests

`tests` contains automated coverage. Unit tests cover deterministic contracts
and process-boundary helpers. Integration tests use temporary file-backed SQLite
databases for runtime, migration, schema, and transaction behavior. Test helpers
must not write SQLite, WAL, or SHM artifacts into the repository.
