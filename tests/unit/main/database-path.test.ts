import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { databaseFileName, getDatabaseDirectory, getDatabasePath } from '@main/database'

describe('database path', () => {
  it('derives the database only from the injected userData directory', () => {
    const userDataDirectory = join('injected-user-data', 'health-screening-desktop')

    expect(databaseFileName).toBe('health-screening.sqlite3')
    expect(getDatabaseDirectory(userDataDirectory)).toBe(join(userDataDirectory, 'data'))
    expect(getDatabasePath(userDataDirectory)).toBe(
      join(userDataDirectory, 'data', databaseFileName)
    )
    expect(getDatabasePath(userDataDirectory)).not.toContain(process.cwd())
  })
})
