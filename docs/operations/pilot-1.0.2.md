# Desktop 1.0.2 pilot candidate

This candidate includes merged read-only central history, offline cache/restart recovery, sync dependency diagnostics, enrollment UUID display/copy and data-preserving installer behavior.

The full `pnpm verify` gate passed: formatting, lint, both TypeScript projects and 2175 tests. The new Windows package reached the required packaged SQLite probe, but Windows Application Control blocked execution of `dist/win-unpacked/health-screening-desktop.exe`. No 1.0.2 installer is ready until an administrator approves the build through the normal application-control process (or the approved signing process is configured), the probe passes and NSIS completes.

Keep the `afterPack` hook enabled. After approval, rerun `pnpm build:win`. It must report both the packaged SQLite success and a non-empty new installer. Record the source commit and installer SHA-256. Do not distribute an unpacked directory as an installer or reuse the old 1.0.1 package as evidence of this candidate.

Physical acceptance still requires two test PCs: install with Keep existing data, verify UUID/pending-work preservation, capture offline and restart, reconnect and sync, review central history, test late follow-up and interrupted retrieval, revoke a test credential, restore a synthetic backup, and exercise native PDF dialogs/display scaling. Use synthetic patients. Existing automated cache tests cover restart/offline behavior and prohibit downloaded history from generating authored clinical data or outbox work; those checks do not assert that the second physical laptop was tested.

See the paired CHS-web `docs/sync/HSW-019F-pilot-acceptance.md` for the combined matrix and the provider/FHIR acceptance runner.
