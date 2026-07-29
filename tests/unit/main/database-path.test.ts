import { describe, expect, it } from 'vitest'

import { databaseFileName, getDatabaseDirectory, getDatabasePath } from '@main/database'

describe('database path', () => {
  it('derives the database only from the injected userData directory', () => {
    const userDataDirectory = 'C:\\Users\\test\\AppData\\Roaming\\health-screening-desktop'

    expect(databaseFileName).toBe('health-screening.sqlite3')
    expect(getDatabaseDirectory(userDataDirectory)).toBe(
      'C:\\Users\\test\\AppData\\Roaming\\health-screening-desktop\\data'
    )
    expect(getDatabasePath(userDataDirectory)).toBe(
      'C:\\Users\\test\\AppData\\Roaming\\health-screening-desktop\\data\\health-screening.sqlite3'
    )
    expect(getDatabasePath(userDataDirectory)).not.toContain(process.cwd())
  })
})
