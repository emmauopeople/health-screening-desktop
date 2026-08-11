# Installation Location Configuration

HSD-029C-P0 adds a trusted main-process authority for the single screening
location assigned to one desktop installation. The renderer is never the
operational location authority; temporary renderer selections are setup inputs
only until the main process persists the configuration.

## Persistence

Schema version 6 creates `installation_location_configuration`, a singleton
strict table with:

- one row maximum for the installation;
- `installation_id`;
- `location_id`;
- `configured_at` and `configured_by`;
- `updated_at` and `updated_by`;
- `row_version` for optimistic reconfiguration protection.

The table references `installation(id)`, `locations(id)`, and `users(id)` with
`ON UPDATE RESTRICT ON DELETE RESTRICT`. Migration 6 does not backfill existing
installations, does not infer a location from existing records, and does not
choose the first or only active location. Existing installations without this
row must be handled by callers as `LOCATION_NOT_CONFIGURED`.

## Initial Assignment

The existing first-run bootstrap command already captures the initial screening
location. HSD-029C-P0 persists the bootstrap-created active location as the
configured installation location inside the same bootstrap transaction.

Bootstrap still accepts no caller-supplied IDs, actors, roles, timestamps, audit
metadata, installation IDs, or configuration flags. The trusted bootstrap actor
for the assignment is the newly created first `LOCAL_ADMIN`, and the timestamp
comes from the transaction clock.

Successful bootstrap now creates exactly four audit events:

- `INSTALLATION_INITIALIZED`
- `LOCAL_USER_CREATED`
- `LOCATION_CREATED`
- `INSTALLATION_LOCATION_ASSIGNED`

The assignment audit uses entity type `INSTALLATION`, the installation ID as
the entity ID, user ID set to the created administrator, and metadata containing
only `bootstrap`, `location_id`, and `row_version`.

No outbox event is emitted for this configuration assignment. Existing outbox
writers are aggregate-specific to patient, screening-session, and
screening-encounter synchronization. This installation setting remains local
until a reviewed configuration-sync policy exists.

## Resolver

`resolveConfiguredInstallationLocation()` is an internal main-process service
operation. It accepts no caller-controlled request data and returns only a
sanitized result:

- `RESOLVED` with `{ id, displayName }` for an active configured location;
- `LOCATION_NOT_CONFIGURED` when the singleton row is absent;
- `LOCATION_NOT_FOUND` when the referenced location cannot be resolved;
- `LOCATION_INACTIVE` when the configured location is inactive;
- `UNAVAILABLE` for unexpected repository failures.

The resolver does not fall back to another location, does not consult renderer
memory, does not mutate configuration, and does not expose raw configuration
records.

## Reconfiguration

`reconfigureInstallationLocation({ locationId })` is a main-process application
service for a future admin settings screen. P0 intentionally does not expose a
renderer IPC/preload method or build a settings UI.

The service:

- resolves the current user from the trusted local authentication session;
- requires `LOCAL_ADMIN`;
- strictly accepts exactly `locationId`;
- rejects caller-supplied actor, user, role, installation, timestamp, force, or
  bypass fields;
- validates the proposed location exists and is active;
- blocks changes when active screening work exists;
- treats the same location as `UNCHANGED`;
- updates the singleton row transactionally with row-version protection;
- creates exactly one `INSTALLATION_LOCATION_CHANGED` audit event on a real
  change;
- emits no outbox event under the current local-only configuration policy.

Active screening work is currently defined from approved lifecycle states as:

- any `screening_sessions.status = 'OPEN'` for the current configured location;
- any `screening_encounters.status = 'DRAFT'` for the current configured
  location.

The service does not close sessions, cancel encounters, move records, rewrite
historical location attribution, create daily sessions, create encounters, or
perform clinical calculations.

## Result Boundary

Resolver and reconfiguration results use existing `status` discriminants.
Controlled outcomes are sanitized and do not include SQL, SQLite messages,
database paths, stack traces, authorization internals, authentication tokens,
audit rows, raw configuration records, patient identities, encounter IDs,
session IDs, or clinical data.

Reconfiguration controlled statuses are:

- `UPDATED`
- `UNCHANGED`
- `AUTHENTICATION_REQUIRED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `LOCATION_NOT_CONFIGURED`
- `LOCATION_NOT_FOUND`
- `LOCATION_INACTIVE`
- `ACTIVE_SCREENING_WORK`
- `CONFIGURATION_CONFLICT`
- `UNAVAILABLE`

## Future Boundaries

Future renderer settings work may expose one fixed typed preload method such as
`window.healthScreening.installationSettings.reconfigureLocation({ locationId })`.
That future IPC boundary must enforce trusted-sender validation before parsing,
strictly accept only `locationId`, resolve authentication and authorization in
the main process, and return only the sanitized service result.

P1 must restart from updated `main` only after P0 is reviewed and merged. P1 can
then use `resolveConfiguredInstallationLocation()` as the trusted location
authority for `ensureCurrentScreeningSession()` while still resolving date,
auth, status, audit, and outbox authority inside the main process.
