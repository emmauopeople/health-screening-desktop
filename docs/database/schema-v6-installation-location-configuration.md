# Schema Version 6: Installation Location Configuration

Schema version 6 adds the trusted configured-location persistence required by
HSD-029C-P0.

## Added Table

`installation_location_configuration` is a singleton strict table:

| Column            | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `singleton_id`    | Integer primary key constrained to `1`, enforcing one row maximum. |
| `installation_id` | References the local `installation(id)`.                           |
| `location_id`     | References the configured `locations(id)`.                         |
| `configured_at`   | Authoritative UTC timestamp for initial assignment.                |
| `configured_by`   | Trusted actor user ID for initial assignment.                      |
| `updated_at`      | Authoritative UTC timestamp for the latest update.                 |
| `updated_by`      | Trusted actor user ID for the latest update.                       |
| `row_version`     | Positive integer used for optimistic reconfiguration protection.   |

Foreign keys use `ON UPDATE RESTRICT ON DELETE RESTRICT`. The migration adds:

- `ux_installation_location_configuration_installation`
- `ix_installation_location_configuration_location`

The migration preserves existing installation, location, screening-session,
screening-encounter, audit, and outbox rows. It leaves the configuration absent
for existing installations and performs no automatic location selection,
backfill, or inference.

## Operational Meaning

An absent row means callers must return or handle `LOCATION_NOT_CONFIGURED`.
The schema is intentionally separate from renderer state, browser storage,
environment variables, daily sessions, encounter state, clinical data, sync
state, and arbitrary JSON settings.
