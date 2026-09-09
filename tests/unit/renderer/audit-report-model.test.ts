import { describe, expect, it } from 'vitest'

import {
  applyAuditReportFilters,
  auditFilterSummary,
  createAuditReportPresetRange,
  createInitialAuditReportFilters
} from '../../../src/renderer/src/app/reports/audit-report-model'

const adminId = '11111111-1111-4111-8111-111111111111'

describe('audit report model', () => {
  it('creates inclusive deployment-local presets and UTC half-open search bounds', () => {
    const now = new Date('2026-09-08T15:00:00.000Z')
    const range = createAuditReportPresetRange('LAST_7_DAYS', 'Africa/Douala', now)
    const draft = {
      ...createInitialAuditReportFilters('Africa/Douala', now),
      rangePreset: 'LAST_7_DAYS' as const,
      range
    }

    expect(range).toEqual({ from: '2026-09-02', to: '2026-09-08' })
    expect(applyAuditReportFilters(draft, 'Africa/Douala')?.request).toMatchObject({
      occurredFromInclusive: '2026-09-01T23:00:00.000Z',
      occurredToExclusive: '2026-09-08T23:00:00.000Z'
    })
  })

  it('supports all-time and exact actor and entity filters', () => {
    const initial = createInitialAuditReportFilters(
      'Africa/Douala',
      new Date('2026-09-08T15:00:00.000Z')
    )
    const applied = applyAuditReportFilters(
      {
        ...initial,
        query: '  referral status  ',
        rangePreset: 'ALL_TIME',
        actor: `USER:${adminId}`,
        action: 'REFERRAL_STATUS_UPDATED',
        entityType: 'REFERRAL',
        entityId: adminId,
        pageSize: 50
      },
      'Africa/Douala'
    )

    expect(applied?.request).toEqual({
      query: 'referral status',
      occurredFromInclusive: null,
      occurredToExclusive: null,
      actor: { kind: 'USER', userId: adminId },
      action: 'REFERRAL_STATUS_UPDATED',
      entityType: 'REFERRAL',
      entityId: adminId,
      pageSize: 50
    })
    expect(
      auditFilterSummary(applied!, [
        { id: adminId, username: 'admin', displayName: 'Admin User', role: 'LOCAL_ADMIN' }
      ])
    ).toContain('Actor: Admin User')
  })

  it('honors IANA offset changes when creating the exclusive end', () => {
    const initial = createInitialAuditReportFilters(
      'America/New_York',
      new Date('2026-03-08T12:00:00.000Z')
    )
    const applied = applyAuditReportFilters(
      {
        ...initial,
        rangePreset: 'TODAY',
        range: { from: '2026-03-08', to: '2026-03-08' }
      },
      'America/New_York'
    )

    expect(applied?.request).toMatchObject({
      occurredFromInclusive: '2026-03-08T05:00:00.000Z',
      occurredToExclusive: '2026-03-09T04:00:00.000Z'
    })
  })

  it('rejects reversed dates, malformed actors, and entity IDs without a type', () => {
    const initial = createInitialAuditReportFilters('Africa/Douala')

    expect(
      applyAuditReportFilters(
        { ...initial, rangePreset: 'CUSTOM', range: { from: '2026-09-08', to: '2026-09-01' } },
        'Africa/Douala'
      )
    ).toBeNull()
    expect(
      applyAuditReportFilters({ ...initial, actor: 'USER:not-a-uuid' }, 'Africa/Douala')
    ).toBeNull()
    expect(applyAuditReportFilters({ ...initial, entityId: adminId }, 'Africa/Douala')).toBeNull()
  })
})
