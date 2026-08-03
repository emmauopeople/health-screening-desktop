# Patient Repository

HSD-025 adds `src/main/database/repositories/patient` as the main-process-only
boundary over schema-v2 patient registry tables.

## Responsibilities

The repository owns SQL and row decoding for:

- Patient summary reads by ID.
- Local patient search by code, name, phone, DOB, approximate age, sex, village,
  and quarter with page sizes `25`, `50`, or `100`.
- Duplicate candidate lookup with deterministic reason codes.
- Transaction-scoped patient creation.

Creation writes the patient, active `LOCAL_PATIENT_CODE` identifier,
participation/data-use acknowledgment, and pending outbox item in the caller's
transaction. It allocates the next `PT-######` code from `local_sequences`
inside that same transaction.

## Boundaries

The repository does not decide whether duplicates may be overridden and does
not write audit events. Those workflow decisions belong to the patient registry
application service.

The repository does not return screening, referral, or follow-up values. Those
clinical workflows are not implemented in HSD-025.

All persisted rows are decoded from `unknown`. Malformed registry data fails
closed with controlled repository errors and is not repaired automatically.
