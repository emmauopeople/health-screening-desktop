import { describe, expect, it } from 'vitest'
import {
  backupActionResultSchema,
  backupMetadataSchema,
  backupRequestSchema
} from '@shared/ipc/backup-contracts'
describe('backup contracts', () => {
  it('requires bounded passwords and never accepts renderer paths or authority', () => {
    expect(backupRequestSchema.safeParse({ password: 'a long passphrase' }).success).toBe(true)
    for (const request of [
      { password: 'short' },
      { password: 'a'.repeat(129) },
      { password: 'a'.repeat(12), path: 'secret' },
      { password: 'a'.repeat(12), role: 'LOCAL_ADMIN' }
    ])
      expect(backupRequestSchema.safeParse(request).success).toBe(false)
  })
  it('validates metadata, counts, format, and credential portability', () => {
    const metadata = {
      formatVersion: 1,
      createdAt: '2026-09-16T12:00:00.000Z',
      applicationVersion: '1.0.0',
      schemaVersion: 24,
      installationId: '11111111-1111-4111-8111-111111111111',
      deploymentName: 'Clinic',
      timeZone: 'Africa/Douala',
      counts: { patients: 1, encounters: 2, referrals: 0, users: 1 },
      credentialScope: 'ORIGINAL_OS_PROFILE'
    }
    expect(backupMetadataSchema.safeParse(metadata).success).toBe(true)
    expect(backupMetadataSchema.safeParse({ ...metadata, password: 'secret' }).success).toBe(false)
    expect(
      backupMetadataSchema.safeParse({ ...metadata, counts: { ...metadata.counts, users: -1 } })
        .success
    ).toBe(false)
    expect(
      backupActionResultSchema.safeParse({ ok: true, data: { status: 'SAVED', metadata } }).success
    ).toBe(true)
    expect(
      backupActionResultSchema.safeParse({
        ok: true,
        data: { status: 'SAVED', metadata, path: 'secret' }
      }).success
    ).toBe(false)
  })
})
