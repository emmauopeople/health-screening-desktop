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

Snapshot failures also display a support code. Its stage identifies installation
context, outbox reading, the resource being materialized, actor loading, input
validation, serialization, or batch insertion. Its rule and optional field name
come from closed allowlists. The code contains no patient ID, field value, SQL,
exception message, or credential. Record the full code when reporting a blocked
sync; it narrows the failure without requiring an upload of the local database.
Diagnostics are captured before transaction error sanitization and do not change
rollback, validation, or retry behavior. The next worker run clears stale details.

An empty batch/attempt history with pending outbox signals locates the blockage
before transport, but does not identify the cause. One corrected preparation bug
rejected the valid patient sex `UNKNOWN`; both that value and legacy `NULL` now
transport as `UNKNOWN` without changing the local patient row. Malformed values
still fail preparation transactionally and leave all signals pending.

Patient acknowledgment snapshots use the same history-status validator as the
patient repository. A stored `NOT_REQUESTED` event is valid and remains
`NOT_REQUESTED` in transport, as does the absence of an acknowledgment event.
`ACKNOWLEDGED` and `DECLINED` retain their meaning. This fixes the blocked support
code `PATIENT / INVALID_VALUE / acknowledgment_status` for valid `NOT_REQUESTED`
rows without modifying acknowledgment history or requiring a database migration.

## Read-only delivery diagnostics

With Node 24, run `node scripts/diagnose-sync.mjs` on Windows. It opens the normal
`APPDATA` desktop database read-only; an explicit database path can be supplied
with `--db`. It does not send requests or retry records. It prints aggregate
outcomes from saved batch responses, pending finalized Food/OTC counts, and
measurement-time comparison categories. Patient identifiers, clinical values,
timestamps, and exception details are not printed.

Time comparisons use the latest accepted encounter snapshots in local batch
history and each reading's recorded time zone. They distinguish a first reading
in the encounter's starting minute from readings before that minute or after
the completion minute. This is diagnostic evidence, not authorization to change
clinical timestamps. A later accepted encounter revision may differ from the
one present when an earlier reading was rejected. Local snapshot outcome counts
need not equal PostgreSQL's counts of record revisions.

Run the diagnostic checks with `node --test scripts/test/diagnose-sync.test.mjs`.

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
