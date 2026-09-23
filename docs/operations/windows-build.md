# Build and verify a Windows installer

Run the release build on **Windows with x64 Node.js**. The packaged executable
must run on the build machine to verify its native SQLite module; Linux/WSL
cross-packaging is not supported by this verified Windows release command.

## One build command

From the repository in Git Bash, PowerShell, or Command Prompt:

```sh
corepack pnpm build:win
```

This command stops at the first failure. It:

1. Removes the current version's previous `dist/*-setup.exe` and its blockmap,
   so a failed attempt cannot leave that old installer looking newly built.
   It does not remove other versions, backups, or application data.
2. Checks both TypeScript projects and builds the application.
3. Runs electron-builder with native dependency rebuilding enabled for the
   selected Electron version and Windows x64 target. A failed rebuild stops
   packaging. The global `npmRebuild: false` setting remains for the existing
   non-Windows workflows; this command explicitly overrides it.
4. After packaging, launches `dist/win-unpacked/health-screening-desktop.exe`
   with `ELECTRON_RUN_AS_NODE=1`. It loads **the packaged** `better-sqlite3` from
   `resources/app.asar`, creates an in-memory table, writes and reads a value,
   checks SQLite integrity, and closes the database. It does not launch the
   CHS UI, open the real database, or start background workers.
5. Allows NSIS installer creation only after this check succeeds. The probe
   has a 30-second timeout and must return an explicit success marker.
6. Reports success only when a new, non-empty installer exists. A failed
   builder stage removes any partial current-version installer and blockmap.

Expected messages include:

```text
[Windows build] Packaged SQLite read/write and integrity check passed (in-memory only).
[Windows build] Verified installer: ...\dist\health-screening-desktop-1.0.0-setup.exe
```

Copy only that successful build's installer to the laptop. Older-version
installers and an unpacked folder may remain in `dist`; their presence is not
evidence that the latest build passed. No GitHub publishing or automatic upload
occurs (`--publish never`).

The `afterPack` check also applies when electron-builder is invoked directly
for Windows. Use `build:win` to get the complete type-check, native rebuild,
stale-artifact cleanup, and packaging sequence. Keep the hook enabled.

## Build-machine prerequisites and recovery

- Install the project's Node.js/pnpm toolchain and dependencies using the
  committed lockfile. Run `corepack pnpm install --frozen-lockfile` on a fresh
  checkout; its postinstall native rebuild must also succeed.
- If the log says **Could not find any Visual Studio installation to use**,
  install or modify Visual Studio Build Tools with **Desktop development with
  C++**, the MSVC x64/x86 compiler, and a Windows SDK. VS Code alone is not the
  C++ build toolchain. Reopen the terminal after installation, then rerun the
  single build command.
- If Python cannot be found, install a supported Python version and verify
  `py --list-paths`. Follow node-gyp's Python configuration instructions if
  several Python versions are installed.
- If downloading Electron headers or a native prebuilt binary fails, correct
  the connection/proxy problem shown in the build log and retry. Do not disable
  rebuilding or the packaged SQLite hook to work around it.
- A packaged SQLite failure can indicate a missing `.node` file, incompatible
  native ABI, missing runtime dependencies, or a blocked executable. Keep the
  full build log, check Windows security/quarantine notifications, and retry
  the complete command after correcting the cause. No installer is ready
  until the check passes.
- If a previous CHS process locks `dist/win-unpacked`, close that build and
  retry. Do not delete your installed application's data directory.

Electron and ordinary Node.js use different native module ABIs. After an
Electron rebuild, running Vitest may require rebuilding `better-sqlite3` for
Node.js (`corepack pnpm rebuild better-sqlite3`). Run `build:win` again before
packaging; do not reuse a Node-test native binary in an Electron release.

## Windows acceptance

The automated tests exercise command ordering, early failures, stale/partial
artifact cleanup, probe failures, and the SQL against an in-memory database.
Linux checks do **not** prove a Windows native rebuild or NSIS execution works.

On Windows, run the single command and confirm both success messages. Install
the result over the existing application and test Keep existing data, Start
fresh, backup restore, PDF save/print, and laptop display scaling using
[the reinstallation checklist](windows-reinstallation.md). Only the build PC
needs developer tools; a laptop installing the finished package does not need
Node.js, pnpm, Python, or Visual Studio.

References: [node-gyp Windows prerequisites](https://github.com/nodejs/node-gyp#on-windows),
[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules),
and [electron-builder configuration and hooks](https://www.electron.build/configuration/).
