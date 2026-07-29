# Location Repository

HSD-012 adds a main-process-only typed repository over the existing schema-v1
`locations` table. It does not add location management screens, startup writes,
audit entries, sync work, routing, IPC, preload APIs, renderer UI, or clinical
workflow behavior.

## Table Mapping

The repository owns explicit SQL for the existing `locations` table and does
not change migrations or schema contracts. Location records map these columns:

- `id`
- `name`
- `name_normalized`
- `location_type`
- `village`
- `subdivision`
- `region`
- `directions`
- `is_active`
- `created_by`
- `created_at`
- `updated_by`
- `updated_at`

`hasAny`, `getById`, `listAll`, and `listActive` are read-only. List methods
order by `name_normalized ASC, id ASC`; `listActive` adds `WHERE is_active = 1`.

## Location Identity

Location names are parsed from unknown input by applying Unicode NFKC, rejecting
invalid surrogate pairs and unsafe control text, trimming, and collapsing
Unicode whitespace runs to one ASCII space. Canonical names must be 1 through
120 Unicode code points and contain at least one Unicode letter or decimal
digit.

The normalized lookup key is always derived from the canonical name with
JavaScript lowercasing. The schema-v1 index is not unique, so duplicate names
and duplicate normalized keys remain valid. Row decoding recomputes the
canonical name and normalized key and rejects persisted rows that do not already
match both stored values exactly.

## Location Fields

`location_type` accepts only these exact uppercase values:

- `CHURCH`
- `QUARTER`
- `VILLAGE`
- `COMMUNITY_SITE`
- `OTHER`

`village`, `subdivision`, and `region` are nullable administrative text fields
using the same canonical text rules as names. Whitespace-only strings fail
validation instead of becoming `NULL`.

`directions` is nullable printable text. It uses the same Unicode normalization,
trim, collapse, surrogate, and control checks, with a 1 through 500 code point
limit, but it does not require a letter or decimal digit.

## Inserts

`insert()` requires an authentic active HSD-008
`DatabaseTransactionConnection` as its first executable check. The repository
does not open, commit, roll back, retry, nest transactions, or run transaction
control SQL.

Callers supply the validated ID, display name, location type, nullable
administrative fields, nullable directions, creator ID, and creation timestamp.
The repository derives `name_normalized` internally and writes:

- `is_active = 1`
- `updated_by = createdBy`
- `updated_at = createdAt`

Before insert, the repository strictly decodes the duplicate-ID precheck result.
Only no row or an exact `{ has_existing: 1 }` row is accepted. Duplicate IDs
fail with `LocationAlreadyExistsError`; duplicate names are allowed.

After insert, the repository rereads the row through the same scoped capability
and returns the decoded frozen record. A missing or malformed verification read
is a write failure.

## Errors

Rows and inputs are decoded from `unknown` and fail closed through controlled
errors. Repository errors use fixed messages and omit stacks, causes, SQL,
paths, UUIDs, timestamps, location names, administrative text, directions, row
values, constraint names, and raw driver messages.

Malformed persisted location fields produce `RepositoryDataIntegrityError`.
Only SQLite `SQLITE_CONSTRAINT_PRIMARYKEY` and `SQLITE_CONSTRAINT_UNIQUE` write
failures map to `LocationAlreadyExistsError`; other constraint failures map to
`RepositoryWriteError`.

## Deferred Behavior

HSD-012 deliberately defers location administration workflows, activation or
deactivation flows, audit writes, sync writes, patient or screening workflows,
IPC, preload APIs, renderer routes, navigation, and UI.
