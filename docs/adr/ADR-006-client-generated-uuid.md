# ADR-006: Client-Generated UUID Entity IDs

## Status

Accepted for HSD-008.

## Context

HSD-007 created an empty local schema with text primary keys for operational
entities. HSD-008 still has no repositories, authentication, sync transport, or
server authority, but future local writes need stable identifiers before records
can participate in audit, outbox, and later synchronization flows.

The renderer must not generate trusted entity identifiers. Identifier creation
must stay in the main process with deterministic injection for tests.

## Decision

The main process owns a small entity ID foundation under `src/main/foundation`.
Production entity IDs are generated with `node:crypto.randomUUID()` and accepted
only when they are canonical lowercase UUID version 4 strings.

The exported `EntityId` type is branded so future repository APIs can require a
validated identifier instead of accepting arbitrary strings. Tests and future
services may inject a deterministic generator, but generated values are still
validated at the main-process boundary.

Controlled ID failures use `EntityIdGenerationError`. They do not retain native
or SQLite causes, stacks, raw values, SQL, paths, or driver messages. At most a
sanitized exception-type string is retained.

## Consequences

Future local rows can be created before synchronization assigns any remote
state. Later sync code must treat these IDs as stable local entity IDs and must
not replace them by repairing historical rows.

No schema change is required for HSD-008 because schema version 1 already uses
text primary keys. No seed data, repository, IPC contract, workflow, or renderer
feature is introduced by this decision.

## Rejected Alternatives

- Server-assigned identifiers: rejected for the offline-first local foundation
  because writes must be possible before transport exists.
- SQLite rowids as public identifiers: rejected because rowids are not stable
  cross-system entity IDs and would leak storage implementation details.
- Renderer-generated IDs: rejected because the renderer is not trusted to create
  authoritative local data identifiers.
- Non-UUID custom formats: rejected because UUID v4 is sufficient, standard,
  locally generated, and easy to validate without another dependency.
