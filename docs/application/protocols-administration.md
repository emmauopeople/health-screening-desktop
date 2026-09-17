# Read-only protocol administration

Administration → Protocols displays the saved active protocol and a reference for
the blood-pressure rules used by this application. Only an active LOCAL_ADMIN
with a current authenticated session and no pending password change may access
it. There are no editing, importing, activation or clinical mutation endpoints.

## Source of truth

The active record comes from `protocol_versions`. The read service requires at
most one ACTIVE record, bounds the configuration, validates public metadata and
checks its SHA-256 checksum. It compares the saved `bpScreening` keys and values
with `SCREENING_BP_PROTOCOL_V1` from `src/shared/screening-bp-protocol.ts`.
JSON property ordering does not affect this comparison. Unsupported/missing BP
configuration yields a visible mismatch rather than an assertion of consistency.
Invalid metadata or checksum returns a controlled unavailable result.

The evaluator currently uses the shared rules embedded in the build, rather than
executing arbitrary saved JSON. The page therefore labels its two sections
separately: Active protocol and Blood-pressure screening rules. On a mismatch,
the reference continues to describe the running code and the page requests an
installation review. No-active-protocol is shown explicitly without fabricating
an active version. A failed load clears previous metadata and provides Refresh.

The bundled baseline's epoch effective timestamp is displayed as “Bundled
baseline — no dated start”; it is not presented as a clinical approval date.
Other effective dates are displayed in UTC.

## Existing behavior documented

Thresholds, rest intervals and rules version are read directly from the shared
protocol constant. This change does not modify the evaluator or its constants.

- Initial rest: 5 minutes; repeat interval: at least 1 minute. These are guidance,
  not enforced timers.
- One reading with systolic ≥140 **or** diastolic ≥90 requires a repeat, including
  a first reading at the urgent threshold.
- With at least two readings, systolic ≥180 **or** diastolic ≥120 in the latest
  reading **or** the rounded mean of the last two triggers urgent referral.
- Otherwise, a rounded mean with systolic ≥140 **or** diastolic ≥90 triggers a
  standard referral.
- Otherwise, the outcome is routine.
- Readings are ordered by sequence number. Systolic, diastolic and pulse means
  use only the last two readings and are rounded to whole numbers.

This page documents the existing implementation. It introduces no new clinical
recommendation or claim of external guideline approval. Historical protocol
references and decision evidence are unchanged. The visible disclaimer remains
“Screening guidance is not a diagnosis.”

## Read boundary and verification

`protocols.get()` uses one fixed IPC channel, an empty strict request and a frozen
preload API. Main-frame sender validation, persisted administrator checks and
validated replies protect the boundary. Raw configuration, checksums, internal
IDs and exceptions are not returned to the renderer. No patient records are
queried. Sync, backup/restore, clinical workflows and schema remain unchanged.

Real migrated database tests cover the baseline, read-only operation, reordered
JSON, mismatches, missing active protocol, bad checksums and access revocation.
IPC/preload tests cover sender/request/reply validation and error containment.
Renderer tests cover metadata, rule explanations, mismatches, empty/error states,
retry, authorization and stale responses. Boundary cases use the real evaluator
to verify the documented latest-reading/mean urgent behavior.

Windows acceptance: sign in as LOCAL_ADMIN, open Administration → Protocols,
confirm the active baseline/version and matching-rules message, review all four
outcomes and Refresh. Confirm readability and scrolling on the target laptop.
