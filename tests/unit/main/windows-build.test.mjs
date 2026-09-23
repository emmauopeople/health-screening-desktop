import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import Database from 'better-sqlite3'

import { buildWindows } from '../../../scripts/build-windows.mjs'
import verifyPackagedSqlite, {
  createSqliteProbe,
  successMarker
} from '../../../build/verify-packaged-sqlite.mjs'

const directories = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const projectDir = mkdtempSync(join(tmpdir(), 'CHS build with spaces '))
  directories.push(projectDir)
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'health-screening-desktop', version: '1.0.0' })
  )
  mkdirSync(join(projectDir, 'dist'))
  for (const name of ['typescript', 'electron-vite', 'electron-builder']) {
    const directory = join(projectDir, 'node_modules', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name }))
  }
  const installer = join(projectDir, 'dist', 'health-screening-desktop-1.0.0-setup.exe')
  const appOutDir = join(projectDir, 'dist', 'win-unpacked')
  mkdirSync(join(appOutDir, 'resources'), { recursive: true })
  writeFileSync(join(appOutDir, 'health-screening-desktop.exe'), 'fixture')
  writeFileSync(join(appOutDir, 'resources', 'app.asar'), 'fixture')
  return { projectDir, installer, appOutDir }
}

describe('Windows release command', () => {
  it.each(['linux', 'darwin'])('rejects %s before changing any files', (platform) => {
    const { projectDir, installer } = fixture()
    writeFileSync(installer, 'previous')
    const run = vi.fn()
    expect(() => buildWindows({ projectDir, platform, arch: 'x64', run })).toThrow('on Windows')
    expect(run).not.toHaveBeenCalled()
    expect(readFileSync(installer, 'utf8')).toBe('previous')
  })

  it('rejects non-x64 Node on Windows', () => {
    expect(() => buildWindows({ platform: 'win32', arch: 'arm64' })).toThrow('x64 Node.js')
  })

  it.each([0, 1, 2, 3])(
    'stops after failed stage %i and removes stale or partial release files',
    (failedStage) => {
      const { projectDir, installer } = fixture()
      const unrelated = join(projectDir, 'dist', 'keep.txt')
      writeFileSync(installer, 'stale')
      writeFileSync(`${installer}.blockmap`, 'stale')
      writeFileSync(unrelated, 'keep')
      let index = 0
      const run = vi.fn(() => {
        if (index++ === failedStage) {
          writeFileSync(installer, 'partial')
          writeFileSync(`${installer}.blockmap`, 'partial')
          return { status: 1 }
        }
        return { status: 0 }
      })
      expect(() =>
        buildWindows({ projectDir, platform: 'win32', arch: 'x64', run, log: vi.fn() })
      ).toThrow('No installer is ready')
      expect(run).toHaveBeenCalledTimes(failedStage + 1)
      expect(existsSync(installer)).toBe(false)
      expect(existsSync(`${installer}.blockmap`)).toBe(false)
      expect(readFileSync(unrelated, 'utf8')).toBe('keep')
    }
  )

  it.each([
    { status: null, error: new Error('spawn failed') },
    { status: null, signal: 'SIGTERM' }
  ])('rejects a child process that did not finish successfully', (result) => {
    const { projectDir } = fixture()
    const run = vi.fn(() => result)
    expect(() =>
      buildWindows({ projectDir, platform: 'win32', arch: 'x64', run, log: vi.fn() })
    ).toThrow('No installer is ready')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('requires a fresh non-empty installer even when all tools exit zero', () => {
    const { projectDir, installer } = fixture()
    writeFileSync(installer, 'stale')
    expect(() =>
      buildWindows({
        projectDir,
        platform: 'win32',
        arch: 'x64',
        run: () => ({ status: 0 }),
        log: vi.fn()
      })
    ).toThrow('non-empty')
    expect(existsSync(installer)).toBe(false)
  })

  it('forces native rebuilding and runs local CLIs without a shell before reporting success', () => {
    const { projectDir, installer } = fixture()
    const run = vi.fn((_executable, args, options) => {
      expect(options).toMatchObject({ cwd: projectDir, shell: false, stdio: 'inherit' })
      if (args.includes('nsis')) writeFileSync(installer, 'new installer')
      return { status: 0 }
    })
    const log = vi.fn()
    expect(buildWindows({ projectDir, platform: 'win32', arch: 'x64', run, log })).toBe(installer)
    expect(run.mock.calls.map((call) => call[1].slice(1))).toEqual([
      ['--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false'],
      ['--noEmit', '-p', 'tsconfig.web.json', '--composite', 'false'],
      ['build'],
      ['--win', 'nsis', '--x64', '--publish', 'never', '-c.npmRebuild=true']
    ])
    expect(log).toHaveBeenLastCalledWith(`[Windows build] Verified installer: ${installer}`)
  })
})

describe('packaged SQLite verification hook', () => {
  it('does not change packaging behavior for other platforms', () => {
    const run = vi.fn()
    verifyPackagedSqlite({ electronPlatformName: 'linux' }, { run })
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects Windows verification on a non-Windows host', () => {
    expect(() =>
      verifyPackagedSqlite({ electronPlatformName: 'win32' }, { platform: 'linux' })
    ).toThrow('verified on Windows')
  })

  it.each(['health-screening-desktop.exe', 'resources/app.asar'])(
    'rejects a missing packaged %s',
    (file) => {
      const { appOutDir } = fixture()
      rmSync(join(appOutDir, file))
      const run = vi.fn()
      expect(() =>
        verifyPackagedSqlite(
          { electronPlatformName: 'win32', appOutDir },
          { platform: 'win32', run }
        )
      ).toThrow('missing')
      expect(run).not.toHaveBeenCalled()
    }
  )

  it.each(['ABI mismatch', 'timeout'])(
    'propagates a failed %s check instead of allowing NSIS to continue',
    (reason) => {
      const { appOutDir } = fixture()
      expect(() =>
        verifyPackagedSqlite(
          { electronPlatformName: 'win32', appOutDir },
          {
            platform: 'win32',
            run: () => {
              throw new Error(reason)
            }
          }
        )
      ).toThrow('Installer creation stopped')
    }
  )

  it.each(['', 'unexpected output', `${successMarker}\nextra output`])(
    'rejects an unconfirmed result',
    (output) => {
      const { appOutDir } = fixture()
      expect(() =>
        verifyPackagedSqlite(
          { electronPlatformName: 'win32', appOutDir },
          { platform: 'win32', run: () => output }
        )
      ).toThrow('did not confirm success')
    }
  )

  it('uses the packaged executable and module, bounded execution, and a clean Node environment', () => {
    const { appOutDir } = fixture()
    vi.stubEnv('NODE_PATH', 'external modules')
    vi.stubEnv('NODE_OPTIONS', '--require unrelated-script')
    vi.stubEnv('ELECTRON_NO_ASAR', '1')
    const run = vi.fn(() => `${successMarker}\n`)
    verifyPackagedSqlite(
      { electronPlatformName: 'win32', appOutDir },
      { platform: 'win32', run, log: vi.fn() }
    )
    const [executable, args, options] = run.mock.calls[0]
    expect(executable).toBe(join(appOutDir, 'health-screening-desktop.exe'))
    expect(args[0]).toBe('-e')
    expect(args[1]).toContain(
      JSON.stringify(join(appOutDir, 'resources', 'app.asar', 'node_modules', 'better-sqlite3'))
    )
    expect(options).toMatchObject({
      cwd: appOutDir,
      shell: false,
      timeout: 30_000,
      maxBuffer: 64 * 1024,
      windowsHide: true
    })
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
    for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'ELECTRON_NO_ASAR'])
      expect(options.env[key]).toBeUndefined()
  })

  it('runs the exact probe SQL on real in-memory SQLite and closes it before success', () => {
    let database
    const log = vi.fn()
    runInNewContext(createSqliteProbe('packaged-module'), {
      process: { versions: { electron: 'test-runtime' }, platform: 'win32', arch: 'x64' },
      require: (path) => {
        expect(path).toBe('packaged-module')
        return class {
          constructor(filename) {
            expect(filename).toBe(':memory:')
            database = new Database(filename)
            return database
          }
        }
      },
      console: { log }
    })
    expect(database.open).toBe(false)
    expect(log).toHaveBeenCalledExactlyOnceWith(successMarker)
  })

  it('closes the database without reporting success when a query fails', () => {
    const close = vi.fn()
    const log = vi.fn()
    expect(() =>
      runInNewContext(createSqliteProbe('packaged-module'), {
        process: { versions: { electron: 'test-runtime' }, platform: 'win32', arch: 'x64' },
        require: () =>
          class {
            exec() {
              throw new Error('query failed')
            }
            close = close
          },
        console: { log }
      })
    ).toThrow('query failed')
    expect(close).toHaveBeenCalledOnce()
    expect(log).not.toHaveBeenCalled()
  })

  it('rejects plain Node before attempting to load SQLite', () => {
    const require = vi.fn()
    expect(() =>
      runInNewContext(createSqliteProbe('packaged-module'), {
        process: { versions: {}, platform: 'win32', arch: 'x64' },
        require
      })
    ).toThrow('packaged Windows x64 Electron')
    expect(require).not.toHaveBeenCalled()
  })
})
