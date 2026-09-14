# HSW-013C synchronization administration and status

Status: Implemented

## Purpose

HSW-013C completes the Release 1 desktop synchronization surface for local
administrators. It exposes the protected HSW-013A configuration boundary and a
minimum-necessary operational summary through fixed, authenticated IPC and
preload methods. It does not add a manual synchronization command.

The Sync Center shows only:

- whether synchronization is configured;
- the central API origin and a bounded credential prefix;
- pending local-change and acknowledgment totals;
- automatic retry time, when scheduled; and
- the last completed batch time; and
- the latest worker check time and a controlled failure message, when applicable.

It never returns the installation token, protected credential bytes, request or
response payloads, hashes, local or central patient identifiers, reviewer
evidence, or raw transport errors.

## Configuration boundary

Only an active `LOCAL_ADMIN` session from the trusted application window may
read or change synchronization settings. A configuration save requires the
complete HTTPS API origin and installation enrollment token. Loopback HTTP
remains permitted only by the existing development validation boundary.

The token crosses the isolated preload boundary once, is protected through
Electron `safeStorage` in the main process, and is cleared from renderer state
after every save attempt. SQLite stores only protected bytes and the first 20
token characters. The configuration write and its
`SYNC_TRANSPORT_CONFIGURED` or `SYNC_TRANSPORT_UPDATED` audit event commit in
one transaction. Audit metadata contains no complete credential.

## Automatic status

Operational status is derived from existing `sync_outbox`,
`sync_transport_batches`, and identity-resolution acknowledgment rows. The
renderer can distinguish not configured, up to date, pending, synchronizing,
retry scheduled, and blocked states. It can refresh the summary, but cannot initiate,
cancel, retry, inspect, or alter synchronization work.

The existing worker continues to run once at startup and every five minutes.
No new database migration is required.

The main process shares an in-memory worker monitor with the administrator service.
It records only a UTC timestamp, a closed status code, and a closed phase code.
It holds no credentials, exception text, record identifiers, or clinical values.
This makes credential-loading and snapshot-preparation failures visible even when
no batch or attempt row exists yet. Refresh status to see the latest check.
The monitor resets when the process restarts or configuration is saved successfully;
it is not a durable attempt history. A later run replaces the previous status.

An empty batch/attempt history with pending outbox signals locates the blockage
before transport, but does not identify the cause. One corrected preparation bug
rejected the valid patient sex `UNKNOWN`; both that value and legacy `NULL` now
transport as `UNKNOWN` without changing the local patient row. Malformed values
still fail preparation transactionally and leave all signals pending.

## Verification

Automated evidence covers protected and audited configuration, fail-closed role
and sender authorization, strict IPC and preload validation, bounded status
projection, credential clearing, automatic-only UI wording, error states, and
the available Sync Center navigation route.

Food, OTC, referral, addendum, and review-flag transport remain excluded until
their central contracts are approved.

## Food and OTC extension

[HSW-019A](desktop-sync-food-otc.md) adds finalized Food/OTC transport and supersedes
the Food/OTC exclusion in the historical increment description above. Other
excluded domains remain separate follow-up increments.
