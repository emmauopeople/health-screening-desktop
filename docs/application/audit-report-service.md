# Audit Report Service

HSD-066A adds the read-only foundation for the administrator Audit Reports workspace. It does not
activate the renderer route, render report rows, generate a PDF, export files, change retention, or
modify synchronization behavior.

## Authorization

Every service method calls the authenticated local-session boundary before validating filters or
reading SQLite. Only `LOCAL_ADMIN` is permitted. Signed-out, locked, and password-change-required
sessions return `AUTHENTICATION_REQUIRED`; other authenticated roles return `FORBIDDEN`.

The renderer cannot supply a role or current-user identity. IPC also applies the existing trusted
sender policy before request validation.

## Read Model

`AuditReportRepository` owns the report SQL separately from the append-only `AuditEventRepository`.
It joins audit events to their optional actor and required installation, then strictly decodes:

- event ID, action, entity type, optional entity ID, and UTC occurrence time;
- optional actor ID, username, display name, and role;
- deployment ID, display name, and IANA time zone; and
- canonical bounded audit metadata.

The repository is read-only. It cannot insert, update, redact, delete, repair, or recursively audit
events.

## Filters And Ordering

Search accepts:

- an inclusive UTC start and exclusive UTC end;
- all actors, system events, or one exact user ID;
- one exact action code;
- one exact entity type and an optional exact entity ID;
- bounded free text across action, entity type, entity ID, actor display name, and username; and
- pages of 25, 50, or 100 rows.

An entity ID requires an entity type. Events are ordered by `occurred_at DESC, id DESC`; the total
is calculated from the same predicates even when the requested page is empty. The HSD-066B
renderer converts deployment-local date controls into UTC half-open bounds using the configured
time zone.

## Context

`getContext()` returns the configured deployment plus deterministic actor, action, and entity-type
filter options derived from current audit rows. It separately reports whether system-originated
events exist.

## Failure Boundary

Invalid requests return `VALIDATION_FAILED`. Authentication and authorization results are
controlled. Repository or unexpected failures return `UNAVAILABLE`; SQL, database paths, raw rows,
metadata, identifiers, and exception messages are never logged or exposed.
