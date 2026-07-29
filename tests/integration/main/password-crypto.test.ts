import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createPasswordCredentialService } from '@main/security'

describe('password crypto integration', () => {
  it('hashes and verifies with the production node:crypto adapter', async () => {
    const service = createPasswordCredentialService()
    const password = 'integration passphrase!'

    const first = await service.hash(password)
    const second = await service.hash(password)

    expect(first.passwordSalt).not.toBe(second.passwordSalt)
    expect(first.passwordHash).not.toBe(second.passwordHash)
    await expect(service.verify(password, first)).resolves.toBe(true)
    await expect(service.verify('integration mismatch!', first)).resolves.toBe(false)
  }, 30000)

  it('keeps password modules independent of database and transaction modules', () => {
    const passwordModuleSources = readSourceFiles(join(process.cwd(), 'src/main/security/password'))

    for (const source of passwordModuleSources) {
      expect(source).not.toMatch(/better-sqlite3/u)
      expect(source).not.toMatch(/@main\/database/u)
      expect(source).not.toMatch(/database\/transaction/u)
      expect(source).not.toMatch(/DatabaseTransaction/u)
    }
  })
})

function readSourceFiles(directory: string): string[] {
  const sources: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      sources.push(...readSourceFiles(path))
      continue
    }

    if (entry.isFile() && path.endsWith('.ts')) {
      sources.push(readFileSync(path, 'utf8'))
    }
  }

  return sources
}
