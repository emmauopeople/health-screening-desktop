import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Windows installer configuration', () => {
  it('preserves application user data during an explicit uninstall', () => {
    const configuration = readFileSync(join(__dirname, '../../../electron-builder.yml'), 'utf8')

    expect(configuration).toMatch(/nsis:[\s\S]*deleteAppDataOnUninstall: false/)
    expect(configuration).toContain('include: build/installer.nsh')
  })
})
