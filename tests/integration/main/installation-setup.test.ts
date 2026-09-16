import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareInstallationSetup,
  type InstallationDataChoice,
  type InstallationSetupResult
} from '@main/app/installation-setup'
import { createProductionFirstRunBootstrapService } from '@main/application'
import {
  createDatabaseRuntime,
  createProductionDatabaseMigrationRunner,
  getDatabasePath,
  type DatabaseRuntime
} from '@main/database'

const firstReceipt = '{11111111-1111-4111-8111-111111111111}'
const nextReceipt = '{22222222-2222-4222-8222-222222222222}'
const logger = { info: vi.fn(), error: vi.fn() }
let directory: string
let receiptPath: string
const choose = vi.fn<() => Promise<InstallationDataChoice>>()
const confirmFresh = vi.fn<() => Promise<boolean>>()
const showRecoveryLocation = vi.fn<(path: string) => Promise<void>>()

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'chs-reinstall-'))
  receiptPath = join(directory, 'installation-receipt.txt')
  writeFileSync(receiptPath, firstReceipt)
  choose.mockReset().mockResolvedValue('KEEP')
  confirmFresh.mockReset().mockResolvedValue(true)
  showRecoveryLocation.mockReset().mockResolvedValue(undefined)
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

function prepare(): Promise<InstallationSetupResult | null> {
  return prepareInstallationSetup({
    userDataDirectory: directory,
    receiptPath,
    choose,
    confirmFresh,
    showRecoveryLocation
  })
}
function runtime(): DatabaseRuntime {
  return createDatabaseRuntime({
    databasePath: getDatabasePath(directory),
    migrationRunner: createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger
    }),
    logger
  })
}
function seedFiles(): void {
  mkdirSync(join(directory, 'data'))
  for (const file of [
    'health-screening.sqlite3',
    'health-screening.sqlite3-wal',
    'health-screening.sqlite3-shm'
  ]) {
    writeFileSync(join(directory, 'data', file), `original ${file}`)
  }
}
function readFiles(path: string): Record<string, Buffer> {
  return Object.fromEntries(readdirSync(path).map((file) => [file, readFileSync(join(path, file))]))
}

describe('installation data preservation', () => {
  it('requires configuration on first install and skips only acknowledged ordinary restarts', async () => {
    const setup = await prepare()
    expect(choose).toHaveBeenCalledWith(false)
    // Failed/cancelled startup does not acknowledge the receipt.
    await prepare()
    expect(choose).toHaveBeenCalledTimes(2)
    setup?.complete()
    await prepare()
    expect(choose).toHaveBeenCalledTimes(2)
    writeFileSync(receiptPath, nextReceipt)
    await prepare()
    expect(choose).toHaveBeenCalledTimes(3)
  })

  it('keeps database and sidecars byte-for-byte and prompts again after same-version reinstall', async () => {
    seedFiles()
    const original = readFiles(join(directory, 'data'))
    ;(await prepare())?.complete()
    writeFileSync(receiptPath, nextReceipt)
    ;(await prepare())?.complete()
    expect(choose).toHaveBeenNthCalledWith(2, true)
    expect(readFiles(join(directory, 'data'))).toEqual(original)
    expect(showRecoveryLocation).not.toHaveBeenCalled()
  })

  it.each(['EXIT', 'FRESH'] as const)(
    'leaves data untouched when %s is cancelled',
    async (choice) => {
      seedFiles()
      const original = readFiles(join(directory, 'data'))
      choose.mockResolvedValue(choice)
      confirmFresh.mockResolvedValue(false)
      expect(await prepare()).toBeNull()
      expect(readFiles(join(directory, 'data'))).toEqual(original)
      expect(readdirSync(directory)).not.toContain('installation-setup-complete.txt')
      expect(readdirSync(directory)).not.toContain('recovery')
    }
  )

  it('archives all database sidecars together and retains earlier recovery copies', async () => {
    seedFiles()
    const original = readFiles(join(directory, 'data'))
    mkdirSync(join(directory, 'recovery'))
    writeFileSync(join(directory, 'recovery', 'previous-backup'), 'retain me')
    choose.mockResolvedValue('FRESH')
    await prepare()
    const archive = showRecoveryLocation.mock.calls[0]![0]
    expect(readFiles(archive)).toEqual(original)
    expect(readdirSync(directory)).not.toContain('data')
    expect(readFileSync(join(directory, 'recovery', 'previous-backup'), 'utf8')).toBe('retain me')
  })

  it('leaves the original data in place when a recovery folder cannot be created', async () => {
    seedFiles()
    const original = readFiles(join(directory, 'data'))
    writeFileSync(join(directory, 'recovery'), 'blocking file')
    choose.mockResolvedValue('FRESH')
    await expect(prepare()).rejects.toThrow()
    expect(readFiles(join(directory, 'data'))).toEqual(original)
    expect(showRecoveryLocation).not.toHaveBeenCalled()
  })

  it('retains the recovery copy after an interruption following the move', async () => {
    seedFiles()
    const original = readFiles(join(directory, 'data'))
    choose.mockResolvedValue('FRESH')
    showRecoveryLocation.mockRejectedValue(new Error('window failed'))
    await expect(prepare()).rejects.toThrow('window failed')
    expect(readFiles(showRecoveryLocation.mock.calls[0]![0])).toEqual(original)
    expect(readdirSync(directory)).not.toContain('installation-setup-complete.txt')
  })

  it('fails closed for an invalid receipt or unreadable acknowledgement', async () => {
    seedFiles()
    writeFileSync(receiptPath, 'invalid')
    await expect(prepare()).rejects.toThrow('Invalid installation receipt')
    writeFileSync(receiptPath, firstReceipt)
    mkdirSync(join(directory, 'installation-setup-complete.txt'))
    await expect(prepare()).rejects.toThrow()
    expect(choose).not.toHaveBeenCalled()
  })

  it('does not silently replace an incomplete retained database', async () => {
    mkdirSync(join(directory, 'data'))
    writeFileSync(join(directory, 'data', 'health-screening.sqlite3-wal'), 'pending writes')
    await expect(prepare()).rejects.toThrow('Existing application data is incomplete')
    expect(readFileSync(join(directory, 'data', 'health-screening.sqlite3-wal'), 'utf8')).toBe(
      'pending writes'
    )
  })

  it('preserves initialized configuration and credentials; fresh setup requires a new bootstrap', async () => {
    const initial = runtime()
    initial.initialize()
    try {
      const service = createProductionFirstRunBootstrapService({
        connection: initial.getConnection(),
        logger
      })
      await service.initialize({
        deploymentName: 'Retained deployment',
        timeZone: 'Africa/Douala',
        administrator: {
          username: 'admin',
          displayName: 'Administrator',
          temporaryPassword: 'ValidPassw0rd!'
        },
        initialLocation: {
          name: 'Initial clinic',
          locationType: 'CHURCH',
          village: null,
          subdivision: null,
          region: null,
          directions: null
        }
      })
    } finally {
      initial.close()
    }
    const originalBytes = readFiles(join(directory, 'data'))
    ;(await prepare())?.complete()
    expect(readFiles(join(directory, 'data'))).toEqual(originalBytes)
    const kept = runtime()
    kept.initialize()
    let originalUser: unknown
    let originalState: unknown
    try {
      originalState = createProductionFirstRunBootstrapService({
        connection: kept.getConnection(),
        logger
      }).getState()
      expect(originalState).toMatchObject({
        status: 'INITIALIZED',
        installation: { deploymentName: 'Retained deployment' }
      })
      originalUser = kept.getConnection().prepare('SELECT * FROM users').all()
    } finally {
      kept.close()
    }
    writeFileSync(receiptPath, nextReceipt)
    choose.mockResolvedValue('FRESH')
    const freshSetup = await prepare()
    const fresh = runtime()
    fresh.initialize()
    try {
      expect(
        createProductionFirstRunBootstrapService({
          connection: fresh.getConnection(),
          logger
        }).getState()
      ).toEqual({ status: 'REQUIRED' })
      expect(fresh.getConnection().prepare('SELECT * FROM users').all()).toEqual([])
      expect(fresh.getConnection().prepare('SELECT * FROM sync_outbox').all()).toEqual([])
      freshSetup?.complete()
    } finally {
      fresh.close()
    }
    // Verify recovery using the real schema, not just the existence of a backup file.
    const recovered = createDatabaseRuntime({
      databasePath: join(showRecoveryLocation.mock.calls[0]![0], 'health-screening.sqlite3'),
      migrationRunner: createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger
      }),
      logger
    })
    recovered.initialize()
    try {
      expect(
        createProductionFirstRunBootstrapService({
          connection: recovered.getConnection(),
          logger
        }).getState()
      ).toEqual(originalState)
      expect(recovered.getConnection().prepare('SELECT * FROM users').all()).toEqual(originalUser)
      expect(recovered.getConnection().pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      recovered.close()
    }
  })
})
