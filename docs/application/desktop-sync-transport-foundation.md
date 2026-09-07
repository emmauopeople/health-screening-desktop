# HSW-013A desktop synchronization transport foundation

Status: Implemented

## Purpose

HSW-013A adds the durable, main-process-only foundation needed before the
desktop can submit Release 1 synchronization batches. It does not enable
network submission by itself.

The foundation provides:

- protected storage for the central API origin and enrolled installation
  bearer credential;
- deterministic construction of the approved `sync.v1` batch envelope;
- dependency ordering for patient, session, encounter, vitals, and finalized
  Lifestyle snapshots;
- transactional reservation of the existing `sync_outbox` signals used to
  materialize a batch;
- immutable storage of the exact canonical request bytes and SHA-256 digest;
- crash-safe attempt leases, bounded retry scheduling, and expired-lease
  recovery.

Food, OTC, referrals, raw audit-event payloads, and draft Lifestyle data are
not approved sync resources and are rejected at this boundary.

## Credential boundary

The enrolled credential must match `chs_inst_v1_` followed by 43 base64url
characters. Only HTTPS origins are accepted, except loopback HTTP for local
development. User information, paths, query strings, and fragments are
rejected.

The application service accepts a `SyncCredentialProtector`. Production code
uses Electron `safeStorage` through the dedicated adapter. SQLite stores only
the protected bytes encoded as base64 and the non-secret 20-character token
prefix. The public configuration result and state never return the raw token.
The decrypting read method is an internal transport boundary for the later HTTP
worker and must not be exposed through preload or renderer IPC.

## Durable batch state

Migration `0019-sync-transport-foundation.sql` adds
`sync_transport_batches` and `sync_transport_batch_items`.

`PREPARED` batches have exact request bytes but no active lease. Claiming a
batch atomically creates a `sync_attempts` row, increments the attempt count,
and moves the batch to `IN_FLIGHT`. A retry or an expired lease moves it to
`RETRY_WAIT` while preserving the batch ID, request JSON, digest, linked outbox
signals, and attempt history. A database trigger prevents request identity or
content from being rewritten after preparation.

Outbox signals remain reserved as `IN_FLIGHT` until the later response worker
applies terminal per-record outcomes. This prevents another batch from
silently reusing a signal while the exact request is awaiting submission or
recovery.

## Verification

Integration tests prove:

- v18-to-v19 migration, strict tables, foreign keys, state checks, and the
  immutable request trigger;
- plaintext credential exclusion from SQLite and bounded URL/token validation;
- deterministic resource ordering and exact-byte replay after retry/restart;
- attempt leasing, retry timing, and expired-lease recovery;
- atomic rollback when any requested outbox signal cannot be reserved.

## Follow-up implementation

HSW-013B1 supplies canonical snapshot materialization and atomic batch
preparation. HSW-013B2 adds the authenticated HTTP worker, response validation,
exact-byte recovery, and outcome application described in
[`desktop-sync-worker.md`](./desktop-sync-worker.md). HSW-013B3 adds local
Medical ID application and reviewer-resolution delivery in
[`desktop-sync-identity-resolution-delivery.md`](./desktop-sync-identity-resolution-delivery.md).
Food, OTC, and referral transport remain blocked until their central contracts
are frozen.
