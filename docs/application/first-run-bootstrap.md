# First-Run Bootstrap Service

HSD-014 adds a main-process application service for the first local setup
write. It composes the approved installation, password, local-user, location,
audit-event, entity-ID, UTC-clock, and transaction contracts without adding
startup execution, IPC, preload exposure, renderer UI, login, sessions, or
clinical workflows. HSD-015 later exposes this service through trusted IPC and
preload contracts without invoking setup at startup.

## State Semantics

The service derives state only from the installation, local-user, and location
repositories:

- `REQUIRED`: no installation row, no local users, and no locations.
- `INITIALIZED`: the installation row exists and at least one local user and
  one location exist.
- `INCONSISTENT`: any partial setup state.

Partial setup is never repaired, rewritten, deleted, or treated as fresh setup.
The reviewed inconsistency codes are:

- `INSTALLATION_MISSING_WITH_LOCAL_DATA`
- `INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR`
- `INSTALLATION_PRESENT_WITHOUT_LOCATION`
- `INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION`

`getState()` is read-only. It performs no password work, transaction work, ID
generation, timestamp generation, startup write, or audit emission.

## Initialization Sequence

`initialize(input)` accepts an untrusted command and strictly decodes exact
top-level and nested own data-property objects. It reuses the approved
deployment, timezone, username, display-name, location-name, location-type,
geography, and directions parsers. Caller-supplied IDs, timestamps, roles,
flags, normalized keys, credentials, audit actions, actor IDs, metadata, and
persistence fields are not accepted.

The temporary administrator password is hashed exactly once through the
HSD-010 password credential service after command decoding and the first state
check succeed. This asynchronous password work happens before opening the
HSD-008 transaction. The transaction callback remains synchronous and must not
return a promise or thenable.

Inside one `DatabaseTransactionExecutor.run()` callback, the service rechecks
state, calls `nowUtc()` exactly once, calls `newEntityId()` exactly six times,
and writes rows in this order:

1. Installation.
2. Initial active `LOCAL_ADMIN` with `mustChangePassword=true`.
3. Initial active location with administrator create/update provenance.
4. `INSTALLATION_INITIALIZED` audit event.
5. `LOCAL_USER_CREATED` audit event.
6. `LOCATION_CREATED` audit event.

The one timestamp is reused for every created, updated, and occurred-at field.
Any failure escapes the callback so HSD-008 rolls back the whole bootstrap.

## Audit Metadata

First-run audit events have `userId=null` because setup occurs before there is
an authenticated actor session. Metadata is intentionally minimal:

- `{"bootstrap":true}`
- `{"bootstrap":true,"must_change_password":true,"role":"LOCAL_ADMIN"}`
- `{"bootstrap":true,"initial_location":true,"location_type":"CHURCH"}`

The location type varies with the parsed initial-location command. Deployment
name, timezone, username, display name, location name, geography, directions,
passwords, hashes, salts, SQL, paths, IDs, and timestamps are not audit
metadata.

## Deferred Work

The returned result contains frozen installation, administrator, initial
location, and audit records only. It does not include plaintext passwords,
stored credentials, normalized keys, raw rows, SQL results, transaction
capabilities, or dependency references.

The initial location is the first active location created during bootstrap; it
is not a persisted primary or selected location. Schema-v1 has no approved
primary-location setting.

Protocol placeholders, renderer setup, login, password-change workflow,
sessions, authorization, administration UI, and clinical workflows remain
deferred to later reviewed tasks. HSD-015 adds startup composition and fixed IPC
methods only; it does not add setup UI or automatic first-run execution.
HSD-016 adds the renderer setup UI as a consumer of the HSD-015 preload methods,
but it does not change bootstrap service authority, persistence rules, returned
service records, login, sessions, protocol setup, settings writes, or clinical
behavior.
