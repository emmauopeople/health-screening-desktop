import { join } from 'node:path'

export const databaseFileName = 'health-screening.sqlite3'

export function getDatabaseDirectory(userDataDirectory: string): string {
  return join(userDataDirectory, 'data')
}

export function getDatabasePath(userDataDirectory: string): string {
  return join(getDatabaseDirectory(userDataDirectory), databaseFileName)
}
