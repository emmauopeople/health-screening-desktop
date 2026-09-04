# HSW-013B2 desktop synchronization response worker

Status: Implemented

## Purpose

HSW-013B2 builds directly on the HSW-013B1 snapshot-preparation service. A
main-process-only worker claims its already stored canonical request bytes,
sends them to the enrolled central API, validates the complete response, and
applies record outcomes transactionally.

The worker does not rematerialize source rows. The renderer and preload do not
receive credentials, clinical payloads, raw responses, or a manual sync command.

## HTTP and recovery

The worker runs once at startup and then every five minutes. It remains idle
when no protected enrollment credential exists. Requests use the installation
bearer token only in the Authorization header, reject redirects, time out after
30 seconds, and accept no more than 1 MiB of response bytes.

The first attempt posts the exact request persisted by HSW-013B1. After an
uncertain attempt, the worker first calls the batch-recovery endpoint. A 404
causes an exact POST retry; other failures use bounded exponential backoff with
jitter. Batch IDs and request bytes never change during recovery.

## Response application

The response parser rejects unknown fields, invalid enum/identifier/time values,
duplicate or missing outcomes, mismatched batch IDs, and outcomes that do not
exactly match a submitted record identity and revision.

Migration `0020-sync-worker-response.sql` adds paired immutable response JSON
and SHA-256 storage, canonical resource mappings, and retry-history support. In
one SQLite transaction, a valid response:

- stores the exact response and digest;
- completes the active attempt and batch;
- records accepted canonical mappings;
- marks accepted, unchanged, review-required, and non-retryable rejected
  signals terminal; and
- returns retryable signals to bounded local retry state while preserving prior
  batch-item history.

No patient identity value is written by HSW-013B2 itself. HSW-013B3 applies
approved identity values through the separately documented identity-delivery
boundary.

## Verification

Automated evidence covers schema v20 migration and compatibility, reuse of the
HSW-013B1 preparation service, protected HTTP requests, bounded responses,
semantic response validation, exact-byte recovery, transactional terminal and
retryable outcomes, immutable response storage, and retry history.

## Follow-up boundary

HSW-013B3 adds local CHS Medical ID application and installation-scoped
reviewer-resolution pull and acknowledgment in
[`desktop-sync-identity-resolution-delivery.md`](./desktop-sync-identity-resolution-delivery.md).
Administrator configuration and minimum-necessary synchronization status UI
remain HSW-013C work. Food, OTC, referral, addendum, and review-flag transport
remain blocked until their central contracts are frozen.
