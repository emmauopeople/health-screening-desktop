import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function buildWindows({
  projectDir = projectDirectory,
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
  log = console.log
} = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error('Build the Windows x64 installer using x64 Node.js on Windows.')
  }

  const require = createRequire(join(projectDir, 'package.json'))
  const metadata = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
  if (!/^[a-z0-9-]+$/.test(metadata.name) || !/^[0-9A-Za-z.+-]+$/.test(metadata.version)) {
    throw new Error('Invalid package name or version for the Windows installer filename.')
  }
  const installer = join(projectDir, 'dist', `${metadata.name}-${metadata.version}-setup.exe`)

  // Remove only this version's generated release files, never application data.
  // A failed attempt must not leave an older installer looking like a new build.
  rmSync(installer, { force: true })
  rmSync(`${installer}.blockmap`, { force: true })

  const packageBin = (name, relativePath) =>
    join(dirname(require.resolve(`${name}/package.json`)), relativePath)
  const stages = [
    [
      'Main type check',
      packageBin('typescript', 'bin/tsc'),
      ['--noEmit', '-p', 'tsconfig.node.json', '--composite', 'false']
    ],
    [
      'Renderer type check',
      packageBin('typescript', 'bin/tsc'),
      ['--noEmit', '-p', 'tsconfig.web.json', '--composite', 'false']
    ],
    ['Application build', packageBin('electron-vite', 'bin/electron-vite.js'), ['build']],
    [
      'Native rebuild, packaged SQLite check, and installer',
      packageBin('electron-builder', 'cli.js'),
      ['--win', 'nsis', '--x64', '--publish', 'never', '-c.npmRebuild=true']
    ]
  ]

  for (const [label, executable, args] of stages) {
    log(`[Windows build] ${label}`)
    let result
    try {
      result = run(process.execPath, [executable, ...args], {
        cwd: projectDir,
        stdio: 'inherit',
        shell: false
      })
    } catch {
      result = { status: null }
    }
    if (result.error || result.signal || result.status !== 0) {
      rmSync(installer, { force: true })
      rmSync(`${installer}.blockmap`, { force: true })
      throw new Error(
        `${label} failed. No installer is ready. See docs/operations/windows-build.md for recovery steps.`
      )
    }
  }

  if (!existsSync(installer) || statSync(installer).size === 0) {
    rmSync(installer, { force: true })
    rmSync(`${installer}.blockmap`, { force: true })
    throw new Error('The build did not produce a non-empty Windows installer.')
  }
  log(`[Windows build] Verified installer: ${installer}`)
  return installer
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildWindows()
  } catch (error) {
    console.error(`[Windows build] ${error.message}`)
    process.exitCode = 1
  }
}
