# Schema Version 8 - Screening Vitals Drafts

HSD-030A adds schema version 8 for offline Vitals draft persistence. The
migration is forward-only and preserves existing installation, user, location,
patient, session, encounter, audit, and outbox rows. It does not backfill
clinical values, create encounters, complete encounters, close sessions, or add
sync transport.

## Tables

`screening_vitals_drafts` stores one Vitals draft per root screening encounter:

- `id`
- `encounter_id` with a unique constraint and restrict foreign key to
  `screening_encounters(id)`
- `status` as `DRAFT` or `VITALS_COMPLETE`
- optional `weight_kg`, `waist_cm`, and `notes`
- trusted creator/updater actor references
- UTC created/updated timestamps
- `row_version` for optimistic concurrency

`screening_vitals_draft_readings` stores ordered blood-pressure readings for a
draft:

- `id`
- `vitals_draft_id`
- `sequence_number`
- nullable `systolic`, `diastolic`, and `pulse`
- nullable `measurement_site`
- nullable `patient_position`
- nullable `measurement_time`
- UTC created/updated timestamps

Readings are nullable so incomplete draft work can be saved and restored. A
completed Vitals step is enforced by the application service, not by storing
fabricated defaults.

## Constraints

The schema enforces:

- at most one Vitals draft per encounter;
- one reading per draft sequence number;
- positive provided numeric values;
- supported measurement sites `RIGHT_ARM`, `LEFT_ARM`, `LEFT_LEG`, `RIGHT_LEG`;
- supported patient positions `LYING`, `STANDING`, `SITTING`;
- valid `HH:MM` measurement times;
- restrict foreign keys with no cascade deletion of clinical draft data.

The new named indexes are:

- `ix_screening_vitals_drafts_encounter`
- `ux_screening_vitals_draft_readings_sequence`
- `ix_screening_vitals_draft_readings_draft`

## Validation

The version-8 schema validator reuses the version-6 structural invariants and
adds the two Vitals draft tables plus the three Vitals draft indexes. Version 7
remains a data-only baseline protocol migration; version 8 is the next
structural schema target.
