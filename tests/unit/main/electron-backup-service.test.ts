import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupServiceOptions } from '@main/application/backups/backup-service'
const mocks = vi.hoisted(() => ({ save: vi.fn(), open: vi.fn(), compose: vi.fn() }))
vi.mock('electron', () => ({ dialog: { showSaveDialog: mocks.save, showOpenDialog: mocks.open } }))
vi.mock('@main/application/backups/backup-service', () => ({ createBackupService: mocks.compose }))
import { createElectronBackupService } from '@main/application/backups/electron-backup-service'

let root: string | undefined
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('Electron backup composition', () => {
  it('cleans only its abandoned working directory and uses native file dialogs', async () => {
    root = mkdtempSync(join(tmpdir(), 'chs-backup-composition-'))
    for (const dir of ['data', 'recovery', 'backup-work']) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, 'existing'), 'retain')
    }
    writeFileSync(join(root, 'saved.chsbackup'), 'backup')
    createElectronBackupService({
      userDataDirectory: root,
      applicationVersion: '1.0.0',
      connection: {} as BackupServiceOptions['connection'],
      authenticationSessionService: {} as BackupServiceOptions['authenticationSessionService']
    })
    expect(existsSync(join(root, 'backup-work', 'existing'))).toBe(false)
    expect(readFileSync(join(root, 'data', 'existing'), 'utf8')).toBe('retain')
    expect(readFileSync(join(root, 'recovery', 'existing'), 'utf8')).toBe('retain')
    expect(readFileSync(join(root, 'saved.chsbackup'), 'utf8')).toBe('backup')
    const options = mocks.compose.mock.calls[0]![0] as BackupServiceOptions
    mocks.save
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false, filePath: '/selected/backup.chsbackup' })
    mocks.open
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/selected/backup.chsbackup'] })
    expect(await options.chooseDestination()).toBeNull()
    expect(await options.chooseDestination()).toBe('/selected/backup.chsbackup')
    expect(await options.chooseSource()).toBeNull()
    expect(await options.chooseSource()).toBe('/selected/backup.chsbackup')
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ properties: ['openFile'] }))
  })
})
