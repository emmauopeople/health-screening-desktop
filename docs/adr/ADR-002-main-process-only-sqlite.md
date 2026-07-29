# ADR-002: Main-Process-Only SQLite

## Status

Accepted for HSD-006.

## Decision

SQLite is owned by exactly one trusted Electron main-process runtime. The
runtime opens `userData/data/health-screening.sqlite3` after Electron is ready,
verifies its required safety pragmas, and reports only `ready` or `unavailable`
through the existing typed application-health result.

The renderer, preload, shared contracts, and IPC handlers do not receive a
database handle, SQL string, database path, or query capability. HSD-006 adds no
tables, migrations, repositories, or domain operations.

## Rejected Alternatives

- Renderer or preload SQLite access would expand the trust boundary and expose
  storage capabilities to untrusted content.
- A database path supplied by the renderer, environment, command line, or
  working directory would make storage location attacker-controlled or
  installation-dependent.
- An in-memory fallback would hide initialization failure and would not provide
  durable offline storage.

## Consequences

Database startup failure is fatal before the renderer window is created. The
single connection is closed idempotently during orderly shutdown. Numbered
migrations and application schema ownership are deferred to HSD-007.
