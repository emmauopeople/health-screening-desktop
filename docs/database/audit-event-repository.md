# Audit Event Repository

HSD-013 adds a main-process-only typed repository over the existing schema-v1
`audit_log` table. It is an append-only persistence boundary; it does not emit
events, perform first-run setup, authenticate users, authorize actions, expose
IPC, add renderer UI, or implement audit search, retention, export, sync, or
tamper-evident storage.

## Table Mapping

The repository owns explicit SQL for the existing `audit_log` table and does
not change migrations or schema contracts. Audit event records map these
columns:

- `id`
- `installation_id`
- `user_id`
- `action`
- `entity_type`
- `entity_id`
- `occurred_at`
- `metadata_json`

`getById`, `listRecent`, and `listForEntity` are read-only. `insert()` is the
only write method and requires an authentic active HSD-008
`DatabaseTransactionConnection`.

## Codes And Identity

Action and entity-type codes are exact ASCII identifiers. They must be 2 through
64 characters and match `^[A-Z][A-Z0-9_]*$`. The repository does not trim,
normalize, uppercase, or repair codes.

`installation_id` is required and remains enforced by SQLite foreign keys.
`user_id` is nullable for bootstrap or system-originated events; when present,
SQLite enforces that the user exists. `entity_id` is nullable because some audit
events describe an action without one concrete entity row. `listForEntity`
requires a non-null entity ID and does not match rows whose `entity_id` is
`NULL`.

## Metadata

Audit metadata is a bounded JSON object for minimal operational context such as
codes, booleans, counts, and non-sensitive state transitions. The repository
does not claim to detect all sensitive data, PHI, credentials, or unsafe
business content; later services must choose safe metadata deliberately.

The root must be an ordinary object with `Object.prototype` or a null prototype.
Keys must be 1 through 64 ASCII characters and match `^[a-z][a-z0-9_]*$`;
`__proto__`, `prototype`, and `constructor` are reserved. Values may be null,
booleans, safe integers, inert strings, dense arrays, or nested ordinary
objects.

Metadata validation rejects accessors, setters, symbols, functions, bigint,
NaN, infinities, negative zero, unsafe integers, custom prototypes, Date, Map,
Set, Buffer, typed arrays, controls, null bytes, line and paragraph separators,
unpaired surrogate units, cycles, sparse arrays, and proxy traps.

Resource limits are:

- Maximum depth: 4 levels below the root object
- Maximum total nodes: 100, including containers and scalars
- Maximum object properties: 50 per object
- Maximum array elements: 50 per array
- Maximum string length: 256 Unicode code points
- Maximum string UTF-8 size: 1,024 bytes
- Maximum canonical `metadata_json` size: 4,096 UTF-8 bytes

The repository builds a new validated metadata graph, sorts object keys
lexicographically, preserves array order and exact string content, serializes
the copy with `JSON.stringify`, and deep-freezes the graph returned in records.
Persisted `metadata_json` must exactly match this canonical form; valid JSON
with alternate whitespace or unsorted keys fails as data integrity corruption.

## Reads

`getById` validates the ID before SQL and returns `null` only when SQLite
returns `undefined`. Null, primitives, arrays, accessors, symbols, extra fields,
missing fields, malformed metadata, and proxy traps fail closed with
`RepositoryDataIntegrityError`.

`listRecent` orders by `occurred_at DESC, id DESC` and requires an explicit
query limit from 1 through 200. `listForEntity` applies the same ordering and
limit after filtering by `entity_type` and `entity_id`. List containers are
decoded as exact dense arrays through descriptors; holes, accessors, symbols,
extra properties, and proxy traps fail closed.

## Inserts

`insert()` asserts the authentic transaction capability before input validation
or SQL. It validates the exact input object, canonicalizes metadata, performs a
strict duplicate-ID precheck, inserts all columns with bound parameters, and
rereads the new row through the same scoped connection. A missing or malformed
verification read becomes `RepositoryWriteError`.

Duplicate event IDs fail with `AuditEventAlreadyExistsError`. Only SQLite
`SQLITE_CONSTRAINT_PRIMARYKEY` and `SQLITE_CONSTRAINT_UNIQUE` map to that error;
foreign-key failures and other constraints map to `RepositoryWriteError`.

## Errors

Repository errors use fixed messages and sanitized reviewed `errorType` values.
They do not retain causes, stacks, SQL, paths, identifiers, action codes,
entity types, timestamps, metadata keys, metadata values, constraint names, raw
rows, canonical JSON, or driver messages. Audit repository code does not log.

## Deferred Behavior

HSD-013 deliberately defers event-emission services, first-run orchestration,
login and session auditing, authorization, audit-review UI, filtering, export,
retention, sync, FHIR publication, remote logging, hash chains, signatures,
encryption, backup, restore, reporting, printing, and clinical workflow
behavior.
