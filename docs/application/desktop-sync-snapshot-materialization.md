# HSW-013B1: Desktop sync snapshot materialization

Status: Implemented foundation

## Scope

This increment turns eligible desktop `sync_outbox` signals into the canonical full-resource
snapshots defined by CHS sync contract `1.0`. It builds on HSW-013A and does not send network
requests.

The main-process-only preparation service:

- reads due `PENDING` and `FAILED` signals for Patient, Screening Session, Screening Encounter,
  Vitals, and Lifestyle;
- deliberately excludes Food, OTC medication, referral, addendum, review-flag, and other
  operations that are not in sync contract `1.0`;
- reloads current SQLite state instead of uploading audit-oriented `payload_json`;
- coalesces repeated signals for the same resource and uses the newest selected outbox UUID as the
  record delivery identifier;
- reserves every contributing signal while emitting one current snapshot;
- orders records as Patient, Screening Session, Screening Encounter, Vitals, then Lifestyle;
- includes every source and clinical actor referenced by the selected snapshots;
- excludes Lifestyle drafts and in-progress records until their aggregate is `COMPLETE`;
- applies the contract limits of 100 records, 500 contributing signals, and 50 actors; and
- stores canonical request bytes and reserves the selected signals in one SQLite transaction.

If required ownership, actor, revision, or referenced aggregate data is missing or malformed, the
preparation attempt fails closed and leaves all signals unreserved.

## Retry and consistency boundary

HSW-013A remains responsible for durable canonical request bytes, request digests, leases, retry
timing, and exact-byte reuse. HSW-013B1 invokes the same canonical request builder and batch
repository inside the materialization transaction, preventing source rows from changing between
snapshot creation and outbox reservation.

## Follow-up boundary

HSW-013B2 will add the authenticated HTTP client, response-schema validation, and atomic terminal
or retry outcome application. HSW-013B3 will add installation-scoped identity-resolution pull,
local CHS medical-ID commit, and acknowledgment delivery. Renderer and IPC surfaces remain out of
scope for all three worker internals.
