import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProductionDatabaseMigrationRunner,
  createLocalUserRepository,
  parseUsernameIdentity
} from '@main/database'
import { parseEntityId, createUtcClock, parseUtcTimestamp } from '@main/foundation'
import { createPasswordCredentialService } from '@main/security'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  type LocalAuthenticationSessionService
} from '@main/application/authentication/session'
import { createUserAdministrationService } from '@main/application/user-administration/user-administration-service'

import type { UserAdministrationMutationRequest } from '@shared/ipc'

const now = parseUtcTimestamp('2026-09-08T12:00:00.000Z')
const id = (n: number): ReturnType<typeof parseEntityId> =>
  parseEntityId(`69000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
const create = {
  action: 'CREATE' as const,
  username: 'New.Nurse',
  displayName: 'New Nurse',
  role: 'NURSE' as const,
  temporaryPassword: 'temporary-pass-123'
}
const search = { query: '', status: 'ALL' as const, page: 1 }
let db: Database.Database
let actorId = id(2)
let authenticatedAt = now
let failure: Error | undefined
let requireAnyRole: ReturnType<typeof vi.fn>
const passwords = createPasswordCredentialService()
const repository = (): ReturnType<typeof createLocalUserRepository> => createLocalUserRepository(db)
const read = (
  n: number
): NonNullable<ReturnType<ReturnType<typeof createLocalUserRepository>['getById']>> =>
  repository().getById(id(n))!
const auth = (): LocalAuthenticationSessionService =>
  ({ requireAnyRole }) as unknown as LocalAuthenticationSessionService
const service = (): ReturnType<typeof createUserAdministrationService> =>
  createUserAdministrationService({ connection: db, authenticationSessionService: auth() })
const edit = (n = 3): Extract<UserAdministrationMutationRequest, { action: 'UPDATE' }> => ({
  action: 'UPDATE' as const,
  userId: id(n),
  expectedUpdatedAt: read(n).updatedAt,
  displayName: 'Updated Nurse',
  role: 'TRAINED_SCREENER' as const,
  isActive: false,
  reason: 'Staff role changed'
})
function insert(n: number, username: string, role = 'NURSE'): void {
  db.prepare(
    'INSERT INTO users (id,username,username_normalized,display_name,password_hash,password_salt,role,is_active,must_change_password,failed_login_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,0,0,?,?)'
  ).run(id(n), username, username.toLowerCase(), username, 'hash', 'salt', role, now, now)
}
beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: vi.fn(), error: vi.fn() },
    clock: createUtcClock(() => now)
  })(db)
  db.prepare(
    'INSERT INTO installation (singleton_id,id,deployment_name,timezone,created_at,updated_at) VALUES (1,?,?,?,?,?)'
  ).run(id(1), 'Pilot', 'Africa/Douala', now, now)
  insert(2, 'admin', 'LOCAL_ADMIN')
  insert(3, 'nurse')
  actorId = id(2)
  authenticatedAt = now
  failure = undefined
  requireAnyRole = vi.fn(() => {
    if (failure) throw failure
    return { user: repository().getById(actorId)!, authenticatedAt }
  })
})
afterEach(() => db.close())
describe('user administration service', () => {
  it('creates a normalized account with a usable hashed temporary password and a safe audit record', async () => {
    const result = await service().mutate({
      ...create,
      username: '  New.Nurse  ',
      displayName: ' New Nurse '
    })
    expect(result).toMatchObject({
      status: 'SAVED',
      user: {
        username: 'New.Nurse',
        displayName: 'New Nurse',
        mustChangePassword: true,
        isActive: true
      }
    })
    const stored = repository().getAuthenticationByUsername(
      parseUsernameIdentity('new.nurse').username
    )!
    expect(await passwords.verify(create.temporaryPassword, stored.credential)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('passwordHash')
    const event = db.prepare('SELECT * FROM audit_log').get()
    expect(event).toMatchObject({
      user_id: id(2),
      action: 'USER_ADMIN_CREATE',
      entity_id: stored.user.id
    })
    expect(JSON.stringify(event)).not.toContain(create.temporaryPassword)
    expect(await service().mutate({ ...create, username: 'NEW.NURSE' })).toEqual({
      status: 'USERNAME_EXISTS'
    })
    expect(db.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 1 })
  })
  it('filters and paginates safe user records deterministically, treating wildcard characters literally', () => {
    for (let n = 10; n < 40; n++) insert(n, `staff${n}`)
    const first = service().search(search)
    expect(first).toMatchObject({ status: 'LOADED', total: 32, page: 1 })
    if (first.status !== 'LOADED') throw Error('Missing list')
    expect(first.items).toHaveLength(25)
    const next = service().search({ ...search, page: 2 })
    expect(next).toMatchObject({ status: 'LOADED', total: 32, page: 2 })
    if (next.status !== 'LOADED') throw Error('Missing list')
    expect(next.items).toHaveLength(7)
    expect(new Set([...first.items, ...next.items].map((u) => u.id)).size).toBe(32)
    expect(JSON.stringify(first)).not.toMatch(/passwordHash|passwordSalt|usernameNormalized/)
    expect(service().search({ ...search, query: 'STAFF10' })).toMatchObject({
      total: 1,
      items: [{ username: 'staff10' }]
    })
    expect(service().search({ ...search, query: '%' })).toMatchObject({ total: 0 })
    expect(service().search({ ...search, status: 'INACTIVE' })).toMatchObject({ total: 0 })
  })
  it('updates role, name and activation with optimistic concurrency and never modifies the signed-in administrator', async () => {
    const request = edit()
    expect(await service().mutate(request)).toMatchObject({
      status: 'SAVED',
      user: { role: 'TRAINED_SCREENER', isActive: false, displayName: 'Updated Nurse' }
    })
    expect(await service().mutate(request)).toEqual({ status: 'VERSION_CONFLICT' })
    expect(await service().mutate(edit(2))).toEqual({ status: 'SELF_CHANGE_FORBIDDEN' })
    expect(read(2)).toMatchObject({ isActive: true, role: 'LOCAL_ADMIN' })
    expect(service().search({ ...search, status: 'INACTIVE' })).toMatchObject({ total: 1 })
    expect(await service().mutate({ ...edit(), isActive: true })).toMatchObject({
      status: 'SAVED',
      user: { isActive: true }
    })
  })
  it('unlocks accounts and resets credentials, requiring a change at the next sign-in', async () => {
    db.prepare('UPDATE users SET failed_login_count=5,locked_until=? WHERE id=?').run(
      '2099-01-01T00:00:00.000Z',
      id(3)
    )
    expect(
      await service().mutate({
        action: 'UNLOCK',
        userId: id(3),
        expectedUpdatedAt: read(3).updatedAt,
        reason: 'Identity verified'
      })
    ).toMatchObject({ status: 'SAVED', user: { failedLoginCount: 0, lockedUntil: null } })
    expect(
      await service().mutate({
        action: 'RESET_PASSWORD',
        userId: id(3),
        expectedUpdatedAt: read(3).updatedAt,
        temporaryPassword: create.temporaryPassword,
        reason: 'Forgotten password'
      })
    ).toMatchObject({
      status: 'SAVED',
      user: { mustChangePassword: true, failedLoginCount: 0, lockedUntil: null }
    })
    const credential = repository().getAuthenticationByUsername(
      parseUsernameIdentity('nurse').username
    )!.credential
    expect(await passwords.verify(create.temporaryPassword, credential)).toBe(true)
    expect(await passwords.verify('wrong-password-123', credential)).toBe(false)
    expect(db.prepare('SELECT action FROM audit_log ORDER BY occurred_at').all()).toEqual([
      { action: 'USER_ADMIN_UNLOCK' },
      { action: 'USER_ADMIN_RESET_PASSWORD' }
    ])
  })
  it('denies unauthorized and locked sessions, including stale cached administrator permissions', async () => {
    failure = new LocalSessionAuthorizationError()
    expect(service().search(search)).toEqual({ status: 'FORBIDDEN' })
    expect(await service().mutate(create)).toEqual({ status: 'FORBIDDEN' })
    failure = new LocalSessionLockedError()
    expect(await service().mutate(create)).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
    failure = undefined
    db.prepare("UPDATE users SET role='NURSE' WHERE id=?").run(id(2))
    expect(await service().mutate(create)).toEqual({ status: 'FORBIDDEN' })
    expect(requireAnyRole).toHaveBeenCalledWith(['LOCAL_ADMIN'])
    expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 2 })
  })
  it.each(['session', 'role'] as const)(
    'rechecks %s after asynchronous password hashing before any write',
    async (change) => {
      const hash = vi.fn(async (value: unknown) => {
        const credential = await passwords.hash(value)
        if (change === 'session') authenticatedAt = parseUtcTimestamp('2026-09-09T12:00:00.000Z')
        else db.prepare("UPDATE users SET role='NURSE' WHERE id=?").run(id(2))
        return credential
      })
      const guarded = createUserAdministrationService({
        connection: db,
        authenticationSessionService: auth(),
        passwordService: { ...passwords, hash }
      })
      expect(await guarded.mutate(create)).toEqual({
        status: change === 'session' ? 'SESSION_CHANGED' : 'FORBIDDEN'
      })
      expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 2 })
      expect(db.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 })
    }
  )
  it('rejects invalid or overposted changes without writes', async () => {
    expect(await service().mutate({ ...create, username: 'bad username' })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(await service().mutate({ ...create, temporaryPassword: 'too short' })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(await service().mutate({ ...edit(), reason: '  ' })).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(await service().mutate({ ...create, isActive: false } as typeof create)).toEqual({
      status: 'VALIDATION_FAILED'
    })
    expect(service().search({ ...search, page: 0 })).toEqual({ status: 'VALIDATION_FAILED' })
    expect(db.prepare('SELECT count(*) AS n FROM audit_log').get()).toEqual({ n: 0 })
  })
  it('rolls account changes back if the audit record cannot be saved', async () => {
    db.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
    )
    const previous = read(3)
    expect(await service().mutate(edit())).toEqual({ status: 'UNAVAILABLE' })
    expect(read(3)).toEqual(previous)
    expect(await service().mutate(create)).toEqual({ status: 'UNAVAILABLE' })
    expect(repository().getByUsername(parseUsernameIdentity(create.username).username)).toBeNull()
  })
})
