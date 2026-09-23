import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const successMarker = 'CHS_PACKAGED_SQLITE_OK'

export function createSqliteProbe(modulePath) {
  return `
    if (!process.versions.electron || process.platform !== 'win32' || process.arch !== 'x64') {
      throw new Error('Expected the packaged Windows x64 Electron runtime.');
    }
    const Database = require(${JSON.stringify(modulePath)});
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE build_probe (value INTEGER NOT NULL)');
      database.prepare('INSERT INTO build_probe (value) VALUES (?)').run(42);
      const result = database.prepare('SELECT value FROM build_probe').get();
      if (result.value !== 42 || database.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new Error('Packaged SQLite read/write or integrity check failed.');
      }
    } finally {
      database.close();
    }
    console.log(${JSON.stringify(successMarker)});
  `
}

// electron-builder awaits this hook before signing and creating the NSIS target.
export default function verifyPackagedSqlite(
  context,
  { platform = process.platform, run = execFileSync, log = console.log } = {}
) {
  if (context.electronPlatformName !== 'win32') return
  if (platform !== 'win32') {
    throw new Error(
      'Windows packages must be verified on Windows. Run corepack pnpm build:win there.'
    )
  }

  const executable = join(context.appOutDir, 'health-screening-desktop.exe')
  const archive = join(context.appOutDir, 'resources', 'app.asar')
  if (!existsSync(executable) || !existsSync(archive)) {
    throw new Error(
      'Packaged Electron executable or app.asar is missing; installer creation stopped.'
    )
  }

  const env = { ...process.env }
  // Node search/preload overrides must not make a broken package pass using
  // dependencies from the developer's checkout or execute unrelated scripts.
  for (const key of Object.keys(env)) {
    if (
      ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR'].includes(
        key.toUpperCase()
      )
    ) {
      delete env[key]
    }
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  let output
  try {
    output = run(
      executable,
      ['-e', createSqliteProbe(join(archive, 'node_modules', 'better-sqlite3'))],
      {
        cwd: context.appOutDir,
        env,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 64 * 1024
      }
    )
  } catch {
    throw new Error(
      'Packaged SQLite could not load or complete its check. Installer creation stopped. See docs/operations/windows-build.md.'
    )
  }
  if (output.trim() !== successMarker) {
    throw new Error('Packaged SQLite did not confirm success; installer creation stopped.')
  }
  log('[Windows build] Packaged SQLite read/write and integrity check passed (in-memory only).')
}
