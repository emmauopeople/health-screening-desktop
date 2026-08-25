import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion17 } from '@main/database/migrations/schema-v17-contract'
import { SCREENING_BP_PROTOCOL_V1 } from '@shared/screening-bp-protocol'

const now = '2026-08-24T12:00:00.000Z'

describe('schema version 17 blood-pressure screening protocol contract', () => {
  it('upgrades v16 with the versioned blood-pressure rules without changing protocol identity', async () => {
    await withDatabase((connection) => {
      migrateToVersion(connection, 16)
      const before = connection
        .prepare(
          "SELECT id, protocol_key, version_label FROM protocol_versions WHERE status = 'ACTIVE'"
        )
        .get()

      migrateToVersion(connection, 17)

      const protocol = connection
        .prepare(
          "SELECT id, protocol_key, version_label, configuration_json, checksum FROM protocol_versions WHERE status = 'ACTIVE'"
        )
        .get() as {
        id: string
        protocol_key: string
        version_label: string
        configuration_json: string
        checksum: string
      }
      const configuration = JSON.parse(protocol.configuration_json) as {
        bpScreening: Record<string, unknown>
      }

      expect({
        id: protocol.id,
        protocol_key: protocol.protocol_key,
        version_label: protocol.version_label
      }).toEqual(before)
      expect(configuration.bpScreening).toEqual({
        rulesetKey: SCREENING_BP_PROTOCOL_V1.key,
        rulesetVersion: SCREENING_BP_PROTOCOL_V1.version,
        ...SCREENING_BP_PROTOCOL_V1.configuration
      })
      expect(protocol.checksum).toMatch(/^[0-9a-f]{64}$/u)
      expect(() => validateSchemaVersion17(connection, 'compatibility')).not.toThrow()
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(connection.pragma('integrity_check', { simple: true })).toBe('ok')
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-bp-protocol-v17-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    test(connection)
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function migrateToVersion(connection: Database.Database, version: 16 | 17): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, version),
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: { now: () => now },
    expectedHighestVersion: version
  })
}
