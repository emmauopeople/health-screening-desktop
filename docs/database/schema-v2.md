# Schema Version 2

Schema version 2 is the HSD-025 patient registry migration. It preserves the
schema-v1 table set and adds only the local registry support needed for offline
patient search, registration, duplicate review, and local patient tabs.

## Migration

`0002-patient-registry.sql` is immutable after review. It is appended to the
explicit production manifest as version `2`, `patient-registry`.

The migration adds:

- `local_sequences`, a strict table used to allocate local patient codes.
- A `patient_code` sequence row initialized from existing `PT-######` patient
  codes, or `1` for a fresh database.
- `patient_identifiers.status`, nullable for historical rows and constrained to
  `ACTIVE`, `INACTIVE`, or `REPLACED` when present.
- Search indexes for patient DOB, approximate age, residence, and code/name.
- A partial unique index for active `LOCAL_PATIENT_CODE` identifiers.
- Triggers requiring active patients to have exactly one identity age source:
  DOB, or approximate age with reference date.

## Registry Rules

Active patient rows must not have both DOB and approximate age, and must not
have neither. Approximate age must be between 0 and 120 and requires
`age_as_of_date`.

The patient repository allocates `PT-000001`, `PT-000002`, and later local
codes by incrementing `local_sequences` inside the same transaction that creates
the patient, local identifier, participation/data-use acknowledgment, outbox
entry, and audit events.

HSD-025 does not add screening, referral, follow-up, or worklist data. Registry
search responses expose `lastScreening` and `referralFollowUp` as `null`.

## Required Version-2 Objects

Named indexes:

- `ix_patients_date_of_birth`
- `ix_patients_approximate_age`
- `ix_patients_residence_search`
- `ix_patients_code_name`
- `ux_patient_identifiers_active_local_code`

Triggers:

- `patients_hsd025_identity_insert`
- `patients_hsd025_identity_update`

The production schema-version-2 validator composes the full schema-version-1
contract plus these HSD-025 objects.
