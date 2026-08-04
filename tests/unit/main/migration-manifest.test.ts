import { describe, expect, it } from 'vitest'

import {
  canonicalizeMigrationSql,
  computeMigrationChecksum
} from '@main/database/migrations/migration-checksum'
import {
  databaseMigrations,
  targetSchemaVersion
} from '@main/database/migrations/migration-manifest'
import { validateMigrationManifest } from '@main/database/migrations/migration-runner'
import {
  MigrationManifestError,
  type DatabaseMigration
} from '@main/database/migrations/migration-types'

const validMigration: DatabaseMigration = {
  version: 1,
  name: 'initial-schema',
  sql: 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;\n'
}

describe('migration manifest', () => {
  it('defines the exact immutable production catalog through HSD-026 checkpoint A', () => {
    const resolved = validateMigrationManifest(databaseMigrations, {
      expectedHighestVersion: targetSchemaVersion
    })

    expect(Object.isFrozen(databaseMigrations)).toBe(true)
    expect(Object.isFrozen(databaseMigrations[0])).toBe(true)
    expect(
      resolved.map((migration) => ({
        version: migration.version,
        name: migration.name,
        checksumLength: migration.checksum.length
      }))
    ).toEqual([
      { version: 1, name: 'initial-schema', checksumLength: 64 },
      { version: 2, name: 'patient-registry-management', checksumLength: 64 },
      { version: 3, name: 'patient-demographic-amendment-history', checksumLength: 64 }
    ])
    expect(targetSchemaVersion).toBe(3)
    expect(resolved[0]?.checksum).toBe(
      '36bb5114185c0a691c8ba8dc1fdfc749a6f5a7069cbcb5efb88a6b55dd6e5fed'
    )
    expect(resolved[1]?.checksum).toBe(
      '4ea2aa2d257825ae7b0544726a85bdb4da7b45bedb6afd3cc131afad38bb0e15'
    )
  })

  it('rejects malformed manifests deterministically', () => {
    const invalidCases: readonly (readonly DatabaseMigration[])[] = [
      [],
      [{ ...validMigration, version: 0 }],
      [{ ...validMigration, version: -1 }],
      [{ ...validMigration, version: 1.5 }],
      [validMigration, { ...validMigration }],
      [{ ...validMigration, version: 2 }],
      [
        { ...validMigration, version: 1 },
        { version: 3, name: 'third', sql: validMigration.sql }
      ],
      [
        { ...validMigration, version: 1, name: 'same-name' },
        { version: 2, name: 'same-name', sql: validMigration.sql }
      ],
      [{ ...validMigration, name: 'InvalidName' }],
      [{ ...validMigration, name: 'invalid_name' }],
      [{ ...validMigration, sql: '' }],
      [{ ...validMigration, sql: '\r\n' }]
    ]

    for (const invalidManifest of invalidCases) {
      expect(() => validateMigrationManifest(invalidManifest)).toThrow(MigrationManifestError)
    }
  })

  it('enforces the configured production highest version', () => {
    expect(() =>
      validateMigrationManifest(
        [validMigration, { version: 2, name: 'second', sql: 'SELECT 1;' }],
        {
          expectedHighestVersion: 1
        }
      )
    ).toThrow(MigrationManifestError)
  })
})

describe('migration checksum canonicalization', () => {
  it('normalizes one BOM and CRLF or CR line endings before hashing', () => {
    const lfSql = 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;\nSELECT 1;\n'
    const expectedChecksum = computeMigrationChecksum(lfSql)

    expect(canonicalizeMigrationSql(`\uFEFF${lfSql.replaceAll('\n', '\r\n')}`)).toBe(lfSql)
    expect(computeMigrationChecksum(lfSql.replaceAll('\n', '\r\n'))).toBe(expectedChecksum)
    expect(computeMigrationChecksum(lfSql.replaceAll('\n', '\r'))).toBe(expectedChecksum)
    expect(computeMigrationChecksum(`\uFEFF${lfSql}`)).toBe(expectedChecksum)
  })

  it('treats meaningful SQL and whitespace changes as different checksums', () => {
    const base = 'SELECT 1;\n'

    expect(computeMigrationChecksum('SELECT 1; \n')).not.toBe(computeMigrationChecksum(base))
    expect(computeMigrationChecksum('SELECT 2;\n')).not.toBe(computeMigrationChecksum(base))
  })
})
