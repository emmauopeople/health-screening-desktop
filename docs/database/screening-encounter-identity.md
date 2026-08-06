# Screening Encounter Identity

HSD-029A-DB defines the database identity for a screening encounter before the
patient-to-session enrollment service is implemented.

## Canonical Identity

The canonical encounter for enrollment is the root encounter row for one
patient in one screening session:

- `screening_session_id`
- `patient_id`
- `amendment_of_encounter_id IS NULL`

The existing schema already contains `amendment_of_encounter_id`, which
distinguishes root encounter rows from future amendment-history rows. The
identity rule is therefore one root encounter per patient per screening
session.

## Amendment Compatibility

Future amendment rows may reference a root encounter through
`amendment_of_encounter_id`. Those rows are not root enrollment identities and
are not blocked by the root identity constraint.

An `AMENDED` status can therefore be represented without creating another root
encounter for the same patient/session pair. HSD-029A-DB does not implement the
amendment workflow.

## VOID Compatibility

A `VOID` root encounter still occupies the canonical patient/session identity.
The current schema does not document an approved rule that permits starting a
second root encounter in the same screening session after voiding the first
one, so the database continues to prohibit another root row for that pair.

## Constraint

Schema version 5 adds:

```sql
CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
  ON screening_encounters (screening_session_id, patient_id)
  WHERE amendment_of_encounter_id IS NULL;
```

The index is the final concurrency safeguard. Two near-concurrent root inserts
for the same patient/session identity cannot both commit.

Different patients may have encounters in the same screening session, and the
same patient may have encounters in different screening sessions.

## Constraint Classification

The database layer exposes
`classifyScreeningEncounterIdentityConstraintError` for the future
screening-encounter repository. It inspects stable `better-sqlite3` error
properties inside the persistence boundary and returns a closed internal
classification:

- `SCREENING_ENCOUNTER_IDENTITY_CONFLICT`
- `SCREENING_ENCOUNTER_ID_CONFLICT`
- `OTHER_UNIQUE_CONSTRAINT`
- `NOT_A_UNIQUE_CONSTRAINT`

The canonical identity conflict is recognized from the exact constrained
columns reported by SQLite:

- `screening_encounters.screening_session_id`
- `screening_encounters.patient_id`

Raw SQLite errors, paths, messages, and stack traces are not returned across the
repository boundary.

## Existing Data Validation

Before creating the index, migration 5 checks for incompatible duplicate root
pairs using `GROUP BY screening_session_id, patient_id HAVING COUNT(*) > 1`.
If duplicates exist, the migration fails atomically.

The migration does not:

- delete duplicate rows;
- select an arbitrary winner;
- merge clinical records;
- rewrite statuses;
- change encounter timestamps or record versions.

On failure, schema version 4 data remains unchanged and the version-5 index is
not created.

## HSD-029A Boundary

The resumed HSD-029A service will use this database constraint when translating
duplicate patient-to-session enrollment attempts into a controlled idempotent
result. HSD-029A-DB does not add repository methods, application services, IPC,
preload APIs, renderer UI, audit writes, outbox writes, measurements, referrals,
or sync behavior.
