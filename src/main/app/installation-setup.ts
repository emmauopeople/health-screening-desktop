import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { databaseFileName, getDatabaseDirectory } from '@main/database/database-path'

export type InstallationDataChoice = 'KEEP' | 'FRESH' | 'EXIT'

interface InstallationSetupOptions {
  userDataDirectory: string
  receiptPath: string
  choose(hasExistingData: boolean): Promise<InstallationDataChoice>
  confirmFresh(): Promise<boolean>
  showRecoveryLocation(path: string): Promise<void>
}

export interface InstallationSetupResult {
  /** Record completion only after the database and application window open successfully. */
  complete(): void
}

/** Runs under the single-instance lock, before opening SQLite or starting workers. */
export async function prepareInstallationSetup({
  userDataDirectory,
  receiptPath,
  choose,
  confirmFresh,
  showRecoveryLocation
}: InstallationSetupOptions): Promise<InstallationSetupResult | null> {
  const receipt = readFileSync(receiptPath, 'utf8').trim()
  if (!/^\{[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\}$/iu.test(receipt)) {
    throw new Error('Invalid installation receipt. Reinstall the application to repair it.')
  }
  const acknowledgementPath = join(userDataDirectory, 'installation-setup-complete.txt')
  const acknowledged = existsSync(acknowledgementPath)
    ? readFileSync(acknowledgementPath, 'utf8').trim()
    : null
  if (acknowledged === receipt) {
    return {
      complete() {
        // This installer receipt has already been acknowledged.
      }
    }
  }

  const dataDirectory = getDatabaseDirectory(userDataDirectory)
  const hasExistingData = existsSync(dataDirectory) && readdirSync(dataDirectory).length > 0
  const choice = await choose(hasExistingData)
  if (choice === 'EXIT') return null

  if (choice === 'FRESH' && hasExistingData) {
    if (!(await confirmFresh())) return null
    // A same-volume rename preserves the entire SQLite file family (including WAL/SHM).
    // No database connection or worker may be active while this directory moves.
    const recoveryDirectory = join(userDataDirectory, 'recovery')
    mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 })
    const archivePath = join(recoveryDirectory, `data-${Date.now()}-${randomUUID()}`)
    renameSync(dataDirectory, archivePath)
    await showRecoveryLocation(archivePath)
  } else if (hasExistingData && !existsSync(join(dataDirectory, databaseFileName))) {
    throw new Error('Existing application data is incomplete. No files have been replaced.')
  }

  return {
    complete() {
      mkdirSync(userDataDirectory, { recursive: true })
      const temporaryPath = `${acknowledgementPath}.${randomUUID()}.tmp`
      writeFileSync(temporaryPath, receipt, { flag: 'wx', mode: 0o600 })
      renameSync(temporaryPath, acknowledgementPath)
    }
  }
}
