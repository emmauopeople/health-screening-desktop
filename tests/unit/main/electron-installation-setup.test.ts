import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const showMessageBox = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ dialog: { showMessageBox } }))
import { prepareElectronInstallationSetup } from '@main/app/electron-installation-setup'

let directory: string
let receiptPath: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'chs-install-dialog-'))
  receiptPath = join(directory, 'receipt.txt')
  writeFileSync(receiptPath, '{11111111-1111-4111-8111-111111111111}')
  showMessageBox.mockReset()
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
function seed(): void {
  mkdirSync(join(directory, 'data'))
  writeFileSync(join(directory, 'data', 'health-screening.sqlite3'), 'original')
}

describe('Windows installation configuration dialog', () => {
  it('defaults to retaining existing data and exiting safely on close', async () => {
    seed()
    showMessageBox.mockResolvedValue({ response: 2 })
    expect(await prepareElectronInstallationSetup(directory, receiptPath)).toBeNull()
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Keep existing data', 'Start fresh', 'Exit'],
        defaultId: 0,
        cancelId: 2
      })
    )
    expect(readFileSync(join(directory, 'data', 'health-screening.sqlite3'), 'utf8')).toBe(
      'original'
    )
  })

  it('defaults to cancelling the separate fresh-start confirmation', async () => {
    seed()
    showMessageBox.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 })
    expect(await prepareElectronInstallationSetup(directory, receiptPath)).toBeNull()
    expect(showMessageBox).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        buttons: ['Cancel', 'Start fresh'],
        defaultId: 0,
        cancelId: 0
      })
    )
    expect(readFileSync(join(directory, 'data', 'health-screening.sqlite3'), 'utf8')).toBe(
      'original'
    )
  })

  it('offers configuration on a clean installation and supports exiting it', async () => {
    showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await prepareElectronInstallationSetup(directory, receiptPath)).toBeNull()
    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Continue to configuration', 'Exit'],
        defaultId: 0,
        cancelId: 1
      })
    )
    showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await prepareElectronInstallationSetup(directory, receiptPath)).not.toBeNull()
  })

  it('reports the actual retained recovery location after confirmed fresh setup', async () => {
    seed()
    showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 0 })
    expect(await prepareElectronInstallationSetup(directory, receiptPath)).not.toBeNull()
    expect(showMessageBox).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        title: 'CHS — Recovery copy saved',
        detail: expect.stringContaining(join(directory, 'recovery'))
      })
    )
  })

  it('gates the database and workers until installation configuration succeeds', () => {
    const source = readFileSync('src/main/app/lifecycle.ts', 'utf8')
    expect(source.indexOf('await prepareElectronInstallationSetup(')).toBeLessThan(
      source.indexOf('databaseRuntime = createDatabaseRuntime(')
    )
    expect(source.indexOf('installationSetup?.complete()')).toBeGreaterThan(
      source.indexOf('await createOrFocusMainWindow(configuration)')
    )
    expect(source.indexOf('installationSetup?.complete()')).toBeLessThan(
      source.indexOf('syncWorkerScheduler.start()')
    )
  })
})
