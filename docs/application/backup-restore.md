# Desktop backup and restore

Administration → Backup / Restore is available to active LOCAL_ADMIN users. It
uses the existing encrypted `.chsbackup` format without new dependencies or a
schema migration. The sync engine is unchanged.

## User workflow

- Create: enter and confirm a 12–128 character password, then choose where to save.
  The native Save dialog includes connected USB drives and external hard drives;
  no separate drive mode is needed. Keep the drive connected until success, then
  eject it through Windows. Existing files are never overwritten.
- Verify: enter the existing backup password, select a file, and inspect its
  creation time, deployment and patient/encounter/referral/user counts. Counts
  include all persisted records, including drafts, inactive and void records.
- Restore: enter the password and choose Review backup for restore. Review the
  summary, acknowledge replacement and restart, then choose Restore and restart.
  The current data is preserved locally. Sign in using credentials from the
  backup, which may differ from today's credentials.
- Cancel: discards the prepared copy and leaves active records unchanged. Restore
  previews expire after ten minutes. Leaving the workspace discards the preview.

Forgotten backup passwords cannot be recovered. A disconnected/unwritable/full
drive produces a failure message; success is shown only after flush and audit.
An interrupted write can leave an incomplete file if the drive is unavailable
for cleanup. Verify before relying on a copy. An external drive backup does not
include the current profile's operating-system key material.

## Supported restore boundary

Creating and verifying backups work for all installations. This increment only
restores the **same installation before sync has been configured or used**.

Both the live database and backup must have the same installation UUID and must
have no sync configuration keys, transport batches, attempts, identity links,
deliveries, resource mappings, or attempted/nonpending outbox entries. Unsent
PENDING outbox rows with zero attempts remain in the restored snapshot. An active
administrator must exist in the backup. These are read-only checks, repeated at
review, confirmation and startup. Disabling sync alone does not bypass them.

A synced installation requires a separate reconciliation design: restoring old
transport counters or acknowledged record versions can conflict with newer web
records. This workflow does not erase transport history, disable synchronization,
clone installation identity or attempt cross-computer credential portability.
The UI explains why such a restore is blocked while retaining backup/verify.

## Authorization and staging

Five fixed IPC methods validate trusted main-frame senders and strict input:

| Method         | Request                      | Result                                  |
| -------------- | ---------------------------- | --------------------------------------- |
| create         | password                     | SAVED + metadata                        |
| inspect        | password                     | VERIFIED + metadata                     |
| prepareRestore | password                     | RESTORE_READY + metadata + opaque token |
| restore        | token, confirmation: RESTORE | RESTARTING                              |
| discardRestore | token                        | CANCELLED                               |

No renderer paths or installation IDs are accepted. The token binds a private,
authenticated snapshot to the original administrator and authenticated session,
expires after ten minutes, and is consumed once. Confirmation rechecks persisted
administrator state and the snapshot. The original source can be unplugged after
review; CHS owns its validated copy. Passwords remain out of logs and files.

Commit adds a BACKUP_RESTORED event to the replacement snapshot with system actor
and requesting user UUID in metadata (that user may not exist in an older backup).
The live audit receives BACKUP_RESTORE_REQUESTED. Files are flushed and a complete
`restore-pending` directory is published by a same-volume rename. No active SQLite
file is overwritten. A failure to schedule restart removes staged restoration.
The frozen API refuses additional backup operations once restart is accepted.

## Restart, interruption and recovery

The next process acquires the single-instance lock and processes restore-pending
before installer setup, SQLite initialization, scratch cleanup, IPC or workers.
It rechecks the staged SHA-256, schema/metadata and restore eligibility.

1. Rename the entire current `data` directory, including WAL/SHM and other files,
   to `recovery/before-restore-<UUID>`.
2. Rename the prepared directory to `data`.
3. Retire the manifest as `recovery/restore-receipt-<UUID>` before opening SQLite.
4. Initialize the application. If initialization fails, close the database and
   roll back to the preserved directory. A separate durable rollback marker
   allows the next launch to resume an interrupted rollback.
5. On successful startup, report the preserved data location and show login.

Directory existence forms the restore journal and is tested at each rename
boundary. Ambiguous, damaged or unsupported journals stop startup instead of
creating an empty database. If this happens, close CHS and preserve `data`,
`restore-pending` and `recovery` for administrator recovery. Do not delete these
folders to make startup proceed. A failed replacement is retained under
`recovery/failed-restore-<UUID>` after rollback. Recovery copies are never pruned
automatically and consume local disk space. They have the same profile protection
as the original database, not the portable archive's password encryption.

A restore startup defers an unacknowledged installer receipt until the next
ordinary launch so Keep/Fresh cannot intervene during replacement. OS/filesystem
failures may still require administrator recovery; flush/rename behavior does
not provide a guarantee against physical media failure.

## Verification and Windows acceptance

Automated tests use real migrated SQLite databases for backup/restore, same-
installation restrictions, wrong passwords/corruption, session-bound tokens,
expiry, restart failures, disappearing destinations, simulated disk-full writes,
startup rollback and interruption at every replacement/rollback rename boundary.
Renderer tests cover password matching/clearing, summaries, confirmation,
cancellation, late results, busy/navigation state, role gates and safe errors.

Native Windows dialogs, real removable media and the Electron process restart
must be checked on Windows:

1. Open Administration → Backup / Restore. Save a backup to a connected USB or
   external drive; confirm success, eject/reconnect, and verify that file.
2. Check wrong-password rejection, cancelled dialogs and refusal to overwrite an
   existing file. Check counts in the verified summary.
3. On an unsynced test installation, create a backup, then add a synthetic test
   record. Review restore, cancel once, and confirm the new record remains.
4. Repeat review and confirm Restore and restart. Sign in using the backup's
   credentials; confirm the post-backup record is absent and the recovery
   directory reported by CHS contains the previous database.
5. On a synced installation, confirm backup and verify work and restore explains
   the reconciliation restriction. Do not delete sync configuration to bypass it.

The Linux workspace cannot prove real Windows restart or removable-drive behavior.
