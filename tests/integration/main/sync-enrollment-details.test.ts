import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { createProductionDatabaseMigrationRunner } from '@main/database'
import { createProductionSyncAdministrationService } from '@main/application/sync-transport/sync-administration-composition'
import {
  LocalSessionAuthorizationError,
  type LocalAuthenticationSessionService
} from '@main/application'
import { syncEnrollmentDetailsSchema } from '@shared/ipc'

describe('production sync enrollment metadata', () => {
  it('reads the stored identity and configured location without creating IDs or changing data', () => {
    const connection = new Database(':memory:')
    try {
      connection.pragma('foreign_keys = ON')
      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: { info: vi.fn(), error: vi.fn() }
      })(connection)
      const installationId = '10000000-0000-4000-8000-000000000001'
      const userId = '20000000-0000-4000-8000-000000000001'
      const locationId = '30000000-0000-4000-8000-000000000001'
      const now = '2026-10-19T12:00:00.000Z'
      connection
        .prepare("INSERT INTO installation VALUES (1, ?, 'Field PC', 'Africa/Douala', ?, ?)")
        .run(installationId, now, now)
      connection
        .prepare(
          `INSERT INTO users (id,username,username_normalized,display_name,password_hash,password_salt,role,is_active,must_change_password,failed_login_count,created_at,updated_at)
        VALUES (?, 'admin','admin','Admin','hash','salt','LOCAL_ADMIN',1,0,0,?,?)`
        )
        .run(userId, now, now)
      connection
        .prepare(
          `INSERT INTO locations (id,name,name_normalized,location_type,is_active,created_by,created_at,updated_by,updated_at)
        VALUES (?, 'Test site','test site','CHURCH',1,?,?,?,?)`
        )
        .run(locationId, userId, now, userId, now)
      const authenticationSessionService = {
        requireAnyRole: vi.fn(() => ({ user: { id: userId, role: 'LOCAL_ADMIN' } }))
      } as unknown as LocalAuthenticationSessionService
      const service = createProductionSyncAdministrationService({
        connection,
        authenticationSessionService,
        credentialProtector: {
          isAvailable: () => false,
          protect: () => {
            throw new Error('Not used')
          },
          unprotect: () => {
            throw new Error('Not used')
          }
        }
      })
      expect(service.getState()).toMatchObject({
        status: 'READY',
        enrollmentDetails: null,
        configuration: { status: 'NOT_CONFIGURED' }
      })
      connection
        .prepare('INSERT INTO installation_location_configuration VALUES (1,?,?,?,?,?,?,1)')
        .run(installationId, locationId, now, userId, now, userId)
      const changes = connection.prepare('SELECT total_changes() AS count').get()
      const state = service.getState()
      expect(state).toMatchObject({
        status: 'READY',
        enrollmentDetails: {
          installationId,
          sourceLocationId: locationId,
          deploymentName: 'Field PC',
          locationName: 'Test site',
          timezone: 'Africa/Douala'
        }
      })
      expect(connection.prepare('SELECT total_changes() AS count').get()).toEqual(changes)
      if (state.status !== 'READY') throw new Error('Expected ready state')
      expect(syncEnrollmentDetailsSchema.safeParse(state.enrollmentDetails).success).toBe(true)
      expect(
        syncEnrollmentDetailsSchema.safeParse({
          ...state.enrollmentDetails,
          installationToken: 'secret'
        }).success
      ).toBe(false)
      vi.mocked(authenticationSessionService.requireAnyRole).mockImplementation(() => {
        throw new LocalSessionAuthorizationError()
      })
      expect(service.getState()).toEqual({ status: 'FORBIDDEN' })
    } finally {
      connection.close()
    }
  })
})
