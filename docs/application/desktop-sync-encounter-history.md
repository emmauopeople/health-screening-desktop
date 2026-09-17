# HSW-019C encounter history synchronization

Schema 25 adds independent upload records for encounter addenda, immutable review
flag definitions, and review opening/resolution/dismissal events. Deploy the
matching CHS-web contract and PostgreSQL migration 0015 before upgrading desktop.

Existing local addenda and flags are queued on upgrade. The migration retains
their clinical rows and original authors, times and resolution notes. It creates
one opening event per flag and one closure event for resolved/dismissed flags.
Existing unsupported annotation signals are retargeted to child identities;
coalescing avoids duplicate delivery. Restart does not repeat the migration.

SQLite triggers capture history and queue ID-only signals within the same
transaction as each clinical write. The management service continues to write
its audit event in that transaction, while parent-encounter outbox signals are
used for voiding. Addenda and status events reject updates/deletes, and a closed
flag's original definition and resolution are immutable. Failed history/signal
writes roll back clinical changes. Schema validation checks these triggers.

`ENCOUNTER_ADDENDUM`, `ENCOUNTER_REVIEW_FLAG`, and `ENCOUNTER_REVIEW_STATUS` each
use immutable revision 1 and deterministic installation/type/local-ID delivery
identities. Each includes its own original actor and timestamp. Late changes
have their own signals and cannot be acknowledged by an earlier in-flight
batch. Missing actors fail closed. Source encounter location and LOCAL ownership
are checked before materialization; imported history must never enter the outbox.
Batch size and actor limits remain unchanged.

The current desktop has no review-flag reopening action. The server contract can
preserve future reasoned reopening events as separate history; schema 25 only
emits the opening and optional resolution/dismissal currently supported locally.
It does not fabricate lost history or change the encounter's clinical content.

Verify with a completed test encounter: add a note and open a review flag, let
them sync, then resolve or dismiss the flag and sync again. Confirm the three
new resource types in central Sync Monitoring and no duplicates after restart.
Voiding the source encounter later retains its accepted history. Addenda/review
display in the web Patient Viewer remains part of HSW-019D.
