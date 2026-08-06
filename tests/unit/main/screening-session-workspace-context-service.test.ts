import { describe, expect, it } from 'vitest'

import {
  createScreeningSessionWorkspaceContextService,
  ScreeningSessionServiceStateIntegrityError
} from '@main/application'
import type { ScreeningSessionWorkspaceContextService } from '@main/application'
import type { InstallationRecord, LocationRecord, LocationRepository } from '@main/database'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import { createUtcClock } from '@main/foundation'

const installationId = '11111111-1111-4111-8111-111111111111' as EntityId
const adminId = '22222222-2222-4222-8222-222222222222' as EntityId
const firstLocationId = '33333333-3333-4333-8333-333333333333' as EntityId
const secondLocationId = '44444444-4444-4444-8444-444444444444' as EntityId
const inactiveLocationId = '55555555-5555-4555-8555-555555555555' as EntityId
const timestamp = '2026-07-29T00:30:00.000Z' as UtcTimestamp

describe('screening session workspace context service', () => {
  it('returns active locations only in repository order with safe identity fields', () => {
    const context = createContextService({
      locations: [
        createLocation({ id: secondLocationId, name: 'Beta Clinic' }),
        createLocation({ id: firstLocationId, name: 'Central Church' })
      ]
    }).getContext()

    expect(context.activeLocations).toEqual([
      { id: secondLocationId, name: 'Beta Clinic' },
      { id: firstLocationId, name: 'Central Church' }
    ])
    expect(JSON.stringify(context)).not.toContain(inactiveLocationId)
    expect(JSON.stringify(context)).not.toContain('nameNormalized')
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.activeLocations)).toBe(true)
    expect(Object.isFrozen(context.activeLocations[0])).toBe(true)
  })

  it('computes deployment-local date across UTC boundaries and IANA timezone styles', () => {
    expect(
      createContextService({
        clockTimestamp: '2026-07-29T00:30:00.000Z',
        timeZone: 'America/Chicago'
      }).getContext().deploymentLocalDate
    ).toBe('2026-07-28')
    expect(
      createContextService({
        clockTimestamp: '2026-03-08T07:30:00.000Z',
        timeZone: 'America/Chicago'
      }).getContext().deploymentLocalDate
    ).toBe('2026-03-08')
    expect(
      createContextService({
        clockTimestamp: '2026-07-28T23:30:00.000Z',
        timeZone: 'Africa/Douala'
      }).getContext().deploymentLocalDate
    ).toBe('2026-07-29')
  })

  it('fails closed for invalid or missing installation timezone state', () => {
    expect(() =>
      createContextService({
        timeZone: 'Invalid/Timezone'
      }).getContext()
    ).toThrow(ScreeningSessionServiceStateIntegrityError)
    expect(() =>
      createContextService({
        installation: null
      }).getContext()
    ).toThrow(ScreeningSessionServiceStateIntegrityError)
  })
})

function createContextService({
  installation = createInstallation(),
  timeZone,
  clockTimestamp = timestamp,
  locations = []
}: {
  readonly installation?: InstallationRecord | null
  readonly timeZone?: string
  readonly clockTimestamp?: string
  readonly locations?: readonly LocationRecord[]
} = {}): ScreeningSessionWorkspaceContextService {
  return createScreeningSessionWorkspaceContextService({
    installationRepository: {
      get: () =>
        installation === null
          ? null
          : {
              ...installation,
              ...(timeZone === undefined
                ? {}
                : { timeZone: timeZone as InstallationRecord['timeZone'] })
            },
      getState: () => ({ status: 'UNINITIALIZED' }),
      insert: () => {
        throw new Error('Unexpected installation insert.')
      }
    },
    locationRepository: {
      hasAny: () => true,
      getById: () => null,
      getByIdForWrite: () => null,
      listAll: () => [],
      listActive: () => [...locations],
      insert: () => {
        throw new Error('Unexpected location insert.')
      }
    } as unknown as LocationRepository,
    clock: createUtcClock(() => clockTimestamp)
  })
}

function createInstallation(): InstallationRecord {
  return Object.freeze({
    id: installationId,
    deploymentName: 'Test Deployment' as InstallationRecord['deploymentName'],
    timeZone: 'UTC' as InstallationRecord['timeZone'],
    createdAt: timestamp,
    updatedAt: timestamp
  })
}

function createLocation({
  id,
  name
}: {
  readonly id: EntityId
  readonly name: string
}): LocationRecord {
  return Object.freeze({
    id,
    name: name as LocationRecord['name'],
    locationType: 'COMMUNITY_SITE',
    village: null,
    subdivision: null,
    region: null,
    directions: null,
    isActive: true,
    createdBy: adminId,
    createdAt: timestamp,
    updatedBy: adminId,
    updatedAt: timestamp
  })
}
