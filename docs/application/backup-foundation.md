# Desktop backup foundation

This increment implements main-process backup creation and read-only validation.
The Administration → Backup / Restore tab remains planned until the UI increment.
There is no restore endpoint, active database replacement, automatic backup
schedule, or cross-device installation cloning in this change.

## API and access

The frozen preload API exposes `backups.create({ password })` and
`backups.inspect({ password })` through two fixed IPC channels. Passwords must
contain 12–128 characters; they are not trimmed or persisted. UI work must add
password confirmation, explain that lost backup passwords cannot be recovered,
and clear password fields after the operation.

Only an active, unlocked LOCAL_ADMIN whose password change is complete may use
these operations. The main service re-reads the administrator's persisted state,
checks authority after native dialogs and asynchronous work, and prevents a new
login from taking over another login's request. Requests cannot provide paths,
roles, user IDs, or installation IDs. File selection happens in native dialogs.
Sender validation allows only the application's trusted main frame. IPC and
preload validate both request and response shapes; paths, passwords, database
contents, stack traces, and underlying exceptions are never returned or logged.
Only one create/inspect operation may run at a time.

Success returns SAVED or VERIFIED with authenticated metadata: backup time,
application/schema versions, installation ID, deployment name/time zone, counts
of patients/encounters/referrals/users, and ORIGINAL_OS_PROFILE credential scope.
Counts include every persisted row, including drafts/inactive/void records.
Controlled outcomes include cancellation, busy, authentication/authorization
failure, invalid input, invalid backup, unsupported schema, existing destination,
and unavailable. Wrong passwords and damaged archives both return INVALID_BACKUP.

## Creating a consistent backup

1. The native save dialog chooses a `.chsbackup` destination outside managed
   application data. An existing destination is never overwritten; choose a new
   filename even if the operating-system dialog offers replacement.
2. `better-sqlite3.backup()` uses SQLite's online backup API. This produces a
   consistent snapshot, including committed data still in WAL. Ordinary clinical
   writes can continue. It does not copy the live SQLite file directly or stop
   the sync engine.
3. The private snapshot is opened read-only with `trusted_schema=OFF` and
   `query_only=ON`. Validation checks integrity, foreign keys, current schema,
   the complete migration name/checksum history, and a singleton installation.
   Metadata is read from this snapshot, never assembled from later live reads.
4. The snapshot and its metadata are encrypted into a versioned single-file
   archive. The destination is opened exclusively and flushed before success.
   This works without hard links, including removable filesystems. No older
   backup is replaced. A normal failure removes a newly created partial output.
5. The live append-only audit log receives BACKUP_CREATED with format/schema
   versions only. Passwords, filenames, and paths are omitted. If audit insertion
   fails, the newly created output is removed. This success event occurs after
   the snapshot, so it is not included in that same snapshot.

The snapshot includes the entire database: clinical records, users/password
hashes, audit history, settings, installation identity, and pending sync state.
It excludes Electron caches, exported PDFs, installer receipts, earlier recovery
copies, and operating-system key material.

## Archive format version 1

No new crypto dependency is introduced. Node's built-in crypto provides scrypt
and AES-256-GCM. Each archive has a fresh 16-byte random salt and 12-byte random
nonce. The 36-byte header is ASCII `CHSBKP01`, salt, and nonce; all 36 bytes are
GCM additional authenticated data. The final 16 bytes are the authentication tag.
The derived 32-byte key is cleared from its Buffer after use. JavaScript password
strings cannot be reliably zeroed and are never written to disk or logs.

Scrypt parameters are fixed by format version: N=32768, r=8, p=1, key length 32,
maxmem 64 MiB. They are not accepted from an untrusted file. Encrypted plaintext
contains a four-byte big-endian manifest length, strict UTF-8 JSON manifest,
and the SQLite snapshot. The manifest holds metadata and the database SHA-256.
The manifest is bounded to 8 KiB and archives to 2 GiB. All patient data and
deployment metadata are encrypted. This is a project-specific container format;
future changes must use a new format version rather than silently altering it.

Inspection streams decryption into a private workspace. No JSON or SQLite is
parsed until GCM authentication succeeds. It checks the database hash, then
SQLite integrity/foreign keys/schema/migration history and compares metadata
with actual database contents. It never migrates a selected backup or changes
the live clinical database. This first version supports the current schema only;
older/newer schema support requires a deliberate compatibility increment. Large
integrity checks may take time; the UI must show an in-progress state.

## Temporary files and interruption

Private working files live in `userData/backup-work/operation-*`; directories use
0700 and files 0600 where supported. Windows uses the user profile's inherited
ACLs. Normal completion/failure removes the operation directory. On application
startup, under the existing single-instance lock, the production composition
removes abandoned work from this dedicated directory. This cleanup does not
remove user-selected backups or the installer's `recovery` directory.

An abrupt process termination can leave temporary plaintext until the next
successful startup, and can leave an incomplete encrypted destination. A saved
notification is emitted only after the complete output is flushed and audited;
inspection rejects incomplete files. Cleanup is not secure erasure. Choose a
protected backup location and keep an off-device copy for machine-loss recovery.

## Restore boundary for the next increment

A verified backup is not permission to replace the active database. Restore
requires its own authorization, deployment/installation preview, explicit
confirmation, a recovery copy of current data, and a restart with database
handles/workers closed. Do not activate the same installation identity on two
operating desktops. OS-protected sync credentials may only decrypt in the
original OS/Electron profile; a future cross-machine restore must handle
re-enrolment explicitly. This foundation neither rewrites identity nor touches
the sync engine. It must not be presented as a cross-device migration tool.

## Verification

Integration tests use real migrated SQLite databases and verify WAL data,
clinical counts, installation identity, account credential preservation, encrypted
round trips, corruption/wrong-password rejection, compatibility checks,
cancellation, audit failure cleanup, exclusive destinations, session changes,
and temporary-file cleanup. Contract/IPC/preload tests cover bounded requests,
sender isolation, exception containment, result validation, channel registration
rollback, and API freezing. Native Windows save/open dialogs and removable-drive
behavior will need manual acceptance with the upcoming UI.

References: [SQLite online backup API](https://sqlite.org/backup.html) and
[Node cryptography API](https://nodejs.org/api/crypto.html).
