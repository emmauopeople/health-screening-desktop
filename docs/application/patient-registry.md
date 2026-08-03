# Patient Registry Service

HSD-025 adds the main-process patient registry service under
`src/main/application/patients`.

## Use Cases

- Search active local patients with bounded pagination.
- Read a minimized patient summary by ID.
- Find duplicate candidates for a registration draft.
- Create a patient after duplicate review requirements are satisfied.

## Duplicate Review

Duplicate detection runs in the main process. Candidate reasons are
deterministic and renderer-safe:

- Same phone number.
- Same date of birth with similar name.
- Same name and residence.
- Similar age, name, and residence.

When candidates exist, `create` returns `DUPLICATE_REVIEW_REQUIRED` unless the
request includes the exact review token for the current draft and candidate
set. The service never auto-merges patients.

The review token is a SHA-256 digest of canonical draft identity fields and the
candidate IDs, revisions, and reason codes. A stale token causes another review
response without writing patient, identifier, acknowledgment, audit, or outbox
rows.

## Atomic Create

Accepted creation runs in one database transaction. It writes:

- The patient and local patient code identifier.
- The participation/data-use acknowledgment.
- One pending `PATIENT` outbox item.
- `PATIENT_CREATED` audit metadata.
- `DUPLICATE_OVERRIDE` audit metadata when duplicate candidates were reviewed.

The service exposes only public patient summaries. Screening history and
referral/follow-up fields remain `null` in HSD-025.
