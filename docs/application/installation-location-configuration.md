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
row resolve as `LOCATION_NOT_CONFIGURED` until an authenticated local
administrator performs explicit recovery assignment.

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

## Existing-Installation Recovery

`assignInitialInstallationLocation({ locationId })` is a dedicated
main-process operation for installations that were initialized before trusted
installation-location configuration existed. It is not first-run bootstrap and
does not create users, installations, or locations.

The operation:

- resolves the current user from the trusted local authentication session;
- requires `LOCAL_ADMIN`;
- strictly accepts exactly `locationId`;
- rejects caller-supplied actor, user, role, installation, timestamp, force, or
  bypass fields;
- requires the singleton configuration row to be absent before assignment;
- validates the proposed location exists and is active;
- blocks assignment when active screening work exists anywhere in the local
  installation database;
- inserts the singleton row transactionally;
- creates exactly one `INSTALLATION_LOCATION_ASSIGNED` audit event on a real
  assignment;
- emits no outbox event under the current local-only configuration policy.

Repeated assignment to the same already configured location returns
`UNCHANGED`, does not overwrite the row, and creates no audit or outbox event.
Assignment to a different location after configuration exists returns
`LOCATION_ALREADY_CONFIGURED`; reconfiguration remains the separate admin-only
operation.

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

`reconfigureInstallationLocation({ locationId })` is the main-process
application service used by the Administration `Screening Location` workspace
when an authorized administrator changes the configured location.

The service:

- resolves the current user from the trusted local authentication session;
- requires `LOCAL_ADMIN`;
- strictly accepts exactly `locationId`;
- rejects caller-supplied actor, user, role, installation, timestamp, force, or
  bypass fields;
- validates the proposed location exists and is active;
- blocks changes when active screening work exists anywhere in the installation;
- treats the same location as `UNCHANGED`;
- updates the singleton row transactionally with row-version protection;
- creates exactly one `INSTALLATION_LOCATION_CHANGED` audit event on a real
  change;
- emits no outbox event under the current local-only configuration policy.

Active screening work is currently defined from approved lifecycle states as:

- any `screening_sessions.status = 'OPEN'` in the local database;
- any `screening_encounters.status = 'DRAFT'` in the local database.

The active-work check is installation-wide. Active work at the current
configured location, the proposed location, a third legacy location, or any
other locally recorded location blocks initial assignment and real
reconfiguration. Same-location reconfiguration returns `UNCHANGED` before
active-work evaluation because no configuration mutation occurs.

The service does not close sessions, cancel encounters, move records, rewrite
historical location attribution, create daily sessions, create encounters, or
perform clinical calculations.

## Administration Boundary

HSD-029C-P3 exposes a focused renderer administration surface at
Administration > Screening Location. The workspace is visible only to users with
the `LOCAL_ADMIN` role according to the renderer navigation catalog; main
process authentication and authorization remain authoritative for every command.

The fixed preload namespace is:

- `window.healthScreening.installationSettings.getConfiguredLocation()`
- `window.healthScreening.installationSettings.listEligibleLocations()`
- `window.healthScreening.installationSettings.assignInitialLocation({ locationId })`
- `window.healthScreening.installationSettings.reconfigureLocation({ locationId })`

The read operations accept an empty request, and the mutation operations
strictly accept exactly `{ locationId }`. Unexpected fields such as actor, role,
installation ID, timestamp, `force`, `bypass`, or `override` are rejected before
they can become operational authority. The renderer may submit only the selected
location identifier required by the P0 command contract; identity, role,
installation context, validation, active-work protection, audit attribution, and
persistence are resolved in the main process.

The Administration workspace displays `Not configured` when the singleton row is
absent, displays only the safe location name when configured, lists active
eligible locations from the approved location repository boundary, requires an
explicit Save action after selection, and preserves the existing assignment
until a P0 command succeeds. It does not create, edit, activate, or deactivate
locations; it does not manually open daily sessions; and it does not create
patient encounters.

## Result Boundary

Resolver, initial-assignment, and reconfiguration results use existing `status`
discriminants.
Controlled outcomes are sanitized and do not include SQL, SQLite messages,
database paths, stack traces, authorization internals, authentication tokens,
audit rows, raw configuration records, patient identities, encounter IDs,
session IDs, or clinical data.

Mutation controlled statuses are:

- `ASSIGNED`
- `UPDATED`
- `UNCHANGED`
- `AUTHENTICATION_REQUIRED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `LOCATION_NOT_CONFIGURED`
- `LOCATION_NOT_FOUND`
- `LOCATION_INACTIVE`
- `LOCATION_ALREADY_CONFIGURED`
- `ACTIVE_SCREENING_WORK`
- `CONFIGURATION_CONFLICT`
- `UNAVAILABLE`

HSD-029C-P1 consumes `resolveConfiguredInstallationLocation()` as the trusted
location authority for `ensureCurrentScreeningSession()` while still resolving
date, auth, status, audit, and outbox authority inside the main process. If an
existing installation still has no configured location, P1 returns
`LOCATION_NOT_CONFIGURED`; recovery remains the separate authenticated
`LOCAL_ADMIN` assignment operation described above. HSD-029C-P3 gives
administrators a UI for that assignment, but it is still not invoked
automatically by the Screening workflow.
