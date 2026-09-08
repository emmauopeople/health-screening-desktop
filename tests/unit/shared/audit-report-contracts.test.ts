import { describe, expect, it } from 'vitest'

import { auditReportSearchRequestSchema, publicAuditReportEventSchema } from '@shared/ipc'

const eventId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

const validRequest = {
  query: '',
  occurredFromInclusive: '2026-09-01T00:00:00.000Z',
  occurredToExclusive: '2026-10-01T00:00:00.000Z',
  actor: { kind: 'ALL' as const },
  action: null,
  entityType: null,
  entityId: null,
  page: 1,
  pageSize: 25 as const
}

describe('audit report contracts', () => {
  it('accepts bounded UTC filters and all supported actor filters', () => {
    expect(auditReportSearchRequestSchema.safeParse(validRequest).success).toBe(true)
    expect(
      auditReportSearchRequestSchema.safeParse({
        ...validRequest,
        actor: { kind: 'SYSTEM' }
      }).success
    ).toBe(true)
    expect(
      auditReportSearchRequestSchema.safeParse({
        ...validRequest,
        actor: { kind: 'USER', userId }
      }).success
    ).toBe(true)
  })

  it('rejects reversed ranges, entity IDs without a type, and authority over-posting', () => {
    expect(
      auditReportSearchRequestSchema.safeParse({
        ...validRequest,
        occurredToExclusive: validRequest.occurredFromInclusive
      }).success
    ).toBe(false)
    expect(
      auditReportSearchRequestSchema.safeParse({ ...validRequest, entityId: eventId }).success
    ).toBe(false)
    expect(
      auditReportSearchRequestSchema.safeParse({ ...validRequest, currentUserId: userId }).success
    ).toBe(false)
  })

  it('accepts bounded safe audit metadata and rejects malformed event projections', () => {
    const event = {
      id: eventId,
      action: 'PATIENT_CREATED',
      entityType: 'PATIENT',
      entityId: eventId,
      occurredAt: '2026-09-08T10:00:00.000Z',
      actor: {
        id: userId,
        username: 'admin',
        displayName: 'Admin User',
        role: 'LOCAL_ADMIN'
      },
      deployment: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Cameroon Pilot',
        timeZone: 'Africa/Douala'
      },
      metadata: { source: 'LOCAL', changes: ['name', 'phone'] }
    }

    expect(publicAuditReportEventSchema.safeParse(event).success).toBe(true)
    expect(
      publicAuditReportEventSchema.safeParse({
        ...event,
        metadata: { unsafe: Number.NaN }
      }).success
    ).toBe(false)
    expect(
      publicAuditReportEventSchema.safeParse({
        ...event,
        metadata: { constructor: 'unsafe' }
      }).success
    ).toBe(false)
    expect(
      publicAuditReportEventSchema.safeParse({ ...event, passwordHash: 'secret' }).success
    ).toBe(false)
  })
})
