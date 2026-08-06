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
  it('defines the exact immutable production catalog through HSD-029A-DB', () => {
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
      { version: 3, name: 'patient-demographic-amendment-history', checksumLength: 64 },
      { version: 4, name: 'screening-session-lifecycle-foundation', checksumLength: 64 },
      { version: 5, name: 'screening-encounter-identity', checksumLength: 64 }
    ])
    expect(targetSchemaVersion).toBe(5)
    expect(resolved[0]?.checksum).toBe(
      '36bb5114185c0a691c8ba8dc1fdfc749a6f5a7069cbcb5efb88a6b55dd6e5fed'
    )
    expect(resolved[1]?.checksum).toBe(
      '4ea2aa2d257825ae7b0544726a85bdb4da7b45bedb6afd3cc131afad38bb0e15'
    )
    expect(resolved[2]?.checksum).toBe(
      '00c008d071bcdc98a41ec7170a2350ba6602a5accc4262b4a05595a35aa490f1'
    )
    expect(resolved[3]?.checksum).toBe(
      'e781a57be0e28065e68c296a19215896f20c579dbf51c3f0e404cb0c5027dec0'
    )
    expect(resolved[4]?.checksum).toBe(
      '24193da971afd3512901d6e97dff7390fcfb71a106aa1371d3939277ab34023d'
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
