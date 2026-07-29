# Repository Structure

This repository separates Electron process responsibilities so trusted application logic stays outside the renderer.

## Root

- `electron.vite.config.ts` configures the Electron main, preload, and React renderer builds.
- `package.json` defines the pnpm scripts and baseline Electron dependencies.
- `tsconfig.json`, `tsconfig.node.json`, and `tsconfig.web.json` keep TypeScript settings process-aware.

## Main Process

`src/main` owns trusted desktop application behavior. Future work will place application lifecycle code, local configuration, database access, protocol logic, printing, logging, security, and sync/backup orchestration here.

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

`src/main/database/transaction` contains the synchronous write transaction
executor. Future repositories must use this boundary for `BEGIN IMMEDIATE`,
commit, rollback, entity ID, and UTC timestamp coordination.

The renderer must not import from `src/main`.

## Preload Process

`src/preload` exposes a narrow typed bridge through `contextBridge`. HSD-005 exposes only fixed asynchronous application metadata and shell-health methods. It does not expose raw `ipcRenderer`, generic send/execute APIs, filesystem access, shell access, or business operations.

## Renderer

`src/renderer` contains the React presentation layer. `src/renderer/index.html` is the renderer shell, and `src/renderer/src` contains UI code, feature folders, routes, stores, and styles.

Renderer code should treat preload APIs as the only trusted bridge to desktop capabilities.

## Shared Contracts

`src/shared` contains process-neutral TypeScript contracts, schemas, enums, errors, and types. These files may be imported by main, preload, renderer, and tests when the contract is safe to share across process boundaries.

Shared files must not depend on Electron, Node-only APIs, browser globals, or process-specific implementation details.

## Resources

`resources` stores application resources that are not source code, including future protocol definitions, print templates, seed data, and app assets.

## Build

`build` stores packaging/build assets generated or consumed by Electron tooling. Windows installer-specific assets belong in `build/installer-assets`.

## Documentation

`docs` stores architecture notes and implementation documentation. Architecture decision records belong in `docs/adr`. Database runtime, migration, and schema documentation belongs under `docs/database`.

## Tests

`tests` contains automated coverage. Unit tests cover deterministic contracts
and process-boundary helpers. Integration tests use temporary file-backed SQLite
databases for runtime, migration, schema, and transaction behavior. Test helpers
must not write SQLite, WAL, or SHM artifacts into the repository.
