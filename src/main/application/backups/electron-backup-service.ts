import { dialog } from 'electron'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  createBackupService,
  type BackupService,
  type BackupServiceOptions
} from './backup-service'

export function createElectronBackupService(
  options: Pick<
    BackupServiceOptions,
    'connection' | 'authenticationSessionService' | 'applicationVersion' | 'userDataDirectory'
  >
): BackupService {
  const workDirectory = join(options.userDataDirectory, 'backup-work')
  // Under the application's single-instance lock: remove only our abandoned scratch data.
  rmSync(workDirectory, { recursive: true, force: true })
  mkdirSync(workDirectory, { recursive: true, mode: 0o700 })
  return createBackupService({
    ...options,
    workDirectory,
    async chooseDestination() {
      const result = await dialog.showSaveDialog({
        title: 'Save encrypted CHS backup',
        defaultPath: `CHS-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}.chsbackup`,
        filters: [{ name: 'Encrypted CHS backup', extensions: ['chsbackup'] }],
        properties: ['createDirectory']
      })
      return result.canceled ? null : (result.filePath ?? null)
    },
    async chooseSource() {
      const result = await dialog.showOpenDialog({
        title: 'Verify encrypted CHS backup',
        filters: [{ name: 'Encrypted CHS backup', extensions: ['chsbackup'] }],
        properties: ['openFile']
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })
}
