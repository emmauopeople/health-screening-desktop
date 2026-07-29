# ADR-003: better-sqlite3 Native Dependency

## Status

Accepted for HSD-006.

## Decision

HSD-006 pins `better-sqlite3` at `13.0.2` as a production dependency and pins
`@types/better-sqlite3` for compile-time contracts. The main build externalizes
the package so Electron loads its native module at runtime. The existing
`electron-builder install-app-deps` postinstall remains responsible for
Electron-compatible native rebuilding, and electron-builder unpacks the native
`.node` binary outside ASAR.

Future native dependency upgrades require review of Electron ABI compatibility,
the lockfile, Node and Electron development behavior, unpacked Windows output,
and the database integration tests. No alternate SQLite package or ORM is
approved by this decision.

## Packaging Rule

The database file is created at runtime under Electron `userData`; it is never
copied into `app.asar`, build resources, `dist`, or the installation directory.
