import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Windows installer configuration', () => {
  it('removes application user data during an explicit uninstall', () => {
    const configuration = readFileSync(join(__dirname, '../../../electron-builder.yml'), 'utf8')

    expect(configuration).toMatch(/nsis:[\s\S]*deleteAppDataOnUninstall: true/)
  })
})
