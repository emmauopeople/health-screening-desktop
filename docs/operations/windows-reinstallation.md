# Windows installation and application data

The NSIS uninstaller preserves per-user application data by default. Reinstalling
CHS for the **same Windows account** uses that account's existing Electron
`userData` directory. Patient records, accounts, credentials, configuration,
audit history, and pending synchronization work are stored in its `data` folder.
No sync engine, schema, or clinical workflow is changed by this feature.

## First launch after installation

Each installer run writes a new GUID receipt to
`resources/installation-receipt.txt` in the installation directory, including
same-version reinstalls. After acquiring the single-instance lock, the app shows
an **Installation configuration** dialog before opening SQLite or starting
background workers:

- **Keep existing data** (default): reuse the saved deployment, time zone,
  location, accounts, and all records. Continue to the existing login screen.
  Keeping data does not recreate the administrator or reset passwords.
- **Start fresh**: a second dialog defaults to Cancel and explains that pending
  work will not be sent by the new deployment. After confirmation, the entire
  `data` directory is renamed into `userData/recovery/data-<timestamp>-<UUID>`.
  The app displays the recovery location, creates a new database, and opens the
  existing full configuration form for deployment, time zone, administrator,
  and initial location. Old data remains in the recovery copy; this is not
  secure erasure. Existing recovery copies are never removed.
- **Exit** or closing the initial dialog: quit without changing data or
  acknowledging the installation. Setup is offered again on the next launch.
- If no existing data is present, **Continue to configuration** opens the full
  initial configuration form. There is no old database to retain or archive.

The acknowledgement is written atomically only after database initialization and
window loading succeed. Ordinary launches skip the installation-choice dialog;
unfinished initial configuration still appears until bootstrap completes. Every
installer run (including upgrades) requires a new choice on the next launch.
Each Windows user acknowledges independently. Development and other platforms
retain their existing first-run behavior. A Windows unpacked build has no NSIS
receipt; use the installed build for this flow. A missing/invalid receipt on a
packaged Windows launch fails closed instead of silently skipping configuration.

All database handles are closed before the fresh-start rename. SQLite WAL and
SHM files move with the database, so uncheckpointed writes are retained. A
failure to archive prevents creation of a fresh database. If startup fails
after the move, the old data remains in the recovery folder. Cancelling the
fresh-start confirmation quits; relaunch to choose Keep existing data.

## Transition from earlier installers

**Install the new build over the existing application first. Do not uninstall
an older build first:** its already-generated uninstaller has the previous
`deleteAppDataOnUninstall: true` policy. The new policy cannot change an old
uninstaller until the new installer replaces it. Electron-builder upgrades run
the old uninstaller in update mode, which skips the default app-data deletion.
As with other upgrades, make a separate backup while CHS is closed before
validating against important data. Previously deleted data cannot be recovered
by this feature. Do not pass the explicit `--delete-app-data` uninstall flag.

## Windows acceptance test (required before merge)

Use a disposable Windows profile/VM with synthetic patient data. Build using
`corepack pnpm build:win` and run the resulting `dist/*-setup.exe`. `pnpm start`
uses the development lifecycle and cannot verify installer behavior.
The command now requires a successful native rebuild and packaged SQLite check
before creating an installer. See [Windows build and recovery](windows-build.md)
for prerequisites, success messages, and troubleshooting.

1. Install with no existing data. Verify Installation configuration appears,
   then complete the deployment/admin/location form. Create synthetic records.
2. Close and reopen normally. Verify login appears without installation choice.
3. Run the same installer again. Verify configuration appears despite the
   unchanged app version. Choose Keep existing data; verify login, deployment,
   location, users, patients, screenings, referrals, audit history, and any
   pending sync work remain. Do not connect the test to a live sync server.
4. Uninstall using the **new** uninstaller. Check that `userData/data` remains.
   Reinstall; choose Keep existing data and verify the same records again.
5. Reinstall; choose Start fresh, then Cancel. Relaunch and choose Keep existing
   data. Verify all original records remain.
6. Reinstall; confirm Start fresh. Record the recovery path. Verify the complete
   configuration form appears; create a different deployment/admin. Verify old
   accounts/patients are absent and sync needs new configuration. Restart and
   verify the new deployment is used without another installation prompt.
7. With CHS closed, copy the entire recovery folder to a separate test userData
   directory as its `data` folder. Retain the new deployment's data separately.
   Verify original records are readable there. Do not merge database files or
   restore while CHS is running. Protected sync credentials may require the
   original Windows account and Electron profile; re-enrol test credentials if
   needed. This recovery copy is not a substitute for a backup/restore feature.
8. Verify closing the initial setup dialog exits and shows it again on relaunch.
   Test a second Windows account if the installer is deployed for all users.

Automated tests cover receipt changes, acknowledgement, cancellation, intact
file-family preservation, archive failures, interruptions, dialog defaults,
real migrated database reopening, retained credentials, and fresh bootstrap.
Actual NSIS execution, Windows ACLs/file locks, and dialog rendering require the
Windows acceptance test above.

Implementation references: [electron-builder NSIS](https://www.electron.build/nsis/)
and [NSIS GUID creation](https://nsis.sourceforge.io/Create_a_GUID,_a_Globally_Unique_Identifier).
