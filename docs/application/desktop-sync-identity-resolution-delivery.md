# HSW-013B3 desktop identity-resolution delivery

Status: Implemented

## Purpose

HSW-013B3 completes the identity return path for the Release 1 desktop sync
worker. It applies a CHS Medical ID supplied with an accepted patient outcome
and pulls reviewer-approved identity decisions for the enrolled installation.
The implementation remains main-process-only and does not add renderer,
preload, dashboard, or manual-sync behavior.

## Delivery and acknowledgment order

The worker first retries any locally pending acknowledgment. It then pulls at
most 25 decisions from `/api/v1/sync/identity-resolutions/pull`. Every response
is parsed as a strict `identity-resolution-delivery.v1` contract and rejects
unknown fields, duplicate resolution references, duplicate local patients,
invalid UUIDs, patient codes, CHS Medical IDs, revisions, or timestamps.

For each decision, one SQLite transaction verifies the exact local patient UUID,
`PT-######` code, and row revision; writes the active CHS Medical ID; records the
central-person link; and stores the exact acknowledgment request bytes. Only
after that transaction commits may the worker POST those stored bytes to
`/api/v1/sync/identity-resolutions/acknowledge`.

An interrupted or uncertain acknowledgment is retried byte-for-byte after the
next interval or application restart. A matching replay cannot create another
patient identifier. A stale or conflicting patient, central person, Medical ID,
or delivery fails closed and is never acknowledged.

## Persistence

Migration `0021-sync-identity-resolution-delivery.sql` adds strict
`sync_patient_identity_links` and `sync_identity_resolution_deliveries` tables.
Unique constraints prevent one central identity from linking to multiple local
patients. Delivery and acknowledgment-request evidence is immutable; only the
initial `acknowledged_at` transition is permitted.

The CHS Medical ID is a non-demographic identifier. No name, phone, address,
date of birth, raw batch payload, credential, or reviewer evidence is added to
the delivery tables or acknowledgment request.

## Verification

Automated evidence covers schema v21 compatibility, strict pull and
acknowledgment parsing, bounded authenticated routes, batch-returned Medical ID
application, exact acknowledgment retry across a reconstructed worker, no
duplicate identifier creation, stale-revision rollback, and immutable stored
delivery evidence.

## Follow-up boundary

HSW-013C may add administrator configuration and minimum-necessary status UI.
Food, OTC, referral, addendum, and review-flag transport remain excluded until
their central contracts are approved.
