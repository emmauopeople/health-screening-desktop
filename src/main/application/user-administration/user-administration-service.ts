import type Database from 'better-sqlite3'
import {
  createLocalUserRepository,
  createInstallationRepository,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  parseUsernameIdentity,
  parseUserDisplayName,
  parseAuditActionCode,
  parseAuditEntityType
} from '@main/database'
import {
  createSystemEntityIdGenerator,
  createSystemUtcClock,
  parseEntityId,
  parseUtcTimestamp
} from '@main/foundation'
import {
  createPasswordCredentialService,
  parsePlaintextPassword,
  type PasswordCredentialService
} from '@main/security'
import {
  LocalSessionAuthorizationError,
  LocalSessionUnauthenticatedError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  type LocalAuthenticationSessionService
} from '@main/application/authentication/session'
import {
  userAdministrationSearchRequestSchema,
  userAdministrationMutationRequestSchema,
  publicManagedUserSchema,
  type UserAdministrationSearchRequest,
  type UserAdministrationSearchResult,
  type UserAdministrationMutationRequest,
  type UserAdministrationMutationResult,
  type UserAdministrationFailureStatus
} from '@shared/ipc/user-administration-contracts'

type SearchData = Extract<UserAdministrationSearchResult, { ok: true }>['data']
type MutationData = Extract<UserAdministrationMutationResult, { ok: true }>['data']
export interface UserAdministrationService {
  search(request: UserAdministrationSearchRequest): SearchData
  mutate(request: UserAdministrationMutationRequest): Promise<MutationData>
}
class Rejection extends Error {
  constructor(readonly status: UserAdministrationFailureStatus) {
    super(status)
  }
}
export function createUserAdministrationService({
  connection,
  authenticationSessionService: auth,
  passwordService = createPasswordCredentialService()
}: {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly passwordService?: PasswordCredentialService
}): UserAdministrationService {
  const users = createLocalUserRepository(connection)
  const installation = createInstallationRepository(connection)
  const audit = createAuditEventRepository(connection)
  const transactions = createDatabaseTransactionExecutor({
    connection,
    clock: createSystemUtcClock(),
    idGenerator: createSystemEntityIdGenerator()
  })
  const authority = (): ReturnType<LocalAuthenticationSessionService['requireAnyRole']> => {
    const session = auth.requireAnyRole(['LOCAL_ADMIN'])
    const actor = users.getById(session.user.id)
    if (!actor?.isActive || actor.role !== 'LOCAL_ADMIN' || actor.mustChangePassword)
      throw new Rejection('FORBIDDEN')
    return session
  }
  const failure = (error: unknown): { status: UserAdministrationFailureStatus } => {
    if (error instanceof Rejection) return { status: error.status }
    if (error instanceof LocalSessionAuthorizationError) return { status: 'FORBIDDEN' }
    if (
      error instanceof LocalSessionUnauthenticatedError ||
      error instanceof LocalSessionLockedError ||
      error instanceof LocalSessionPasswordChangeRequiredError
    )
      return { status: 'AUTHENTICATION_REQUIRED' }
    return { status: 'UNAVAILABLE' }
  }
  return {
    search(request) {
      try {
        const session = authority()
        const parsed = userAdministrationSearchRequestSchema.safeParse(request)
        if (!parsed.success) return { status: 'VALIDATION_FAILED' }
        const { query, status, page } = parsed.data
        const where =
          "WHERE (instr(lower(username), lower(@query)) > 0 OR instr(lower(display_name), lower(@query)) > 0) AND (@status = 'ALL' OR is_active = @active)"
        const parameters = { query, status, active: status === 'ACTIVE' ? 1 : 0 }
        const total = connection
          .prepare<typeof parameters, { total: number }>(
            `SELECT count(*) AS total FROM users ${where}`
          )
          .get(parameters)!.total
        const ids = connection
          .prepare(
            `SELECT id FROM users ${where} ORDER BY username_normalized, id LIMIT 25 OFFSET @offset`
          )
          .all({ ...parameters, offset: (page - 1) * 25 }) as { id: string }[]
        return {
          status: 'LOADED',
          items: ids.map(({ id }) =>
            publicManagedUserSchema.parse(users.getById(parseEntityId(id)))
          ),
          total,
          page,
          currentUserId: session.user.id
        }
      } catch (error) {
        return failure(error)
      }
    },
    async mutate(request) {
      try {
        const session = authority()
        const parsed = userAdministrationMutationRequestSchema.safeParse(request)
        if (!parsed.success) return { status: 'VALIDATION_FAILED' }
        const data = parsed.data
        let identity: ReturnType<typeof parseUsernameIdentity> | undefined
        let displayName: ReturnType<typeof parseUserDisplayName> | undefined
        try {
          if (data.action === 'CREATE') identity = parseUsernameIdentity(data.username)
          if (data.action === 'CREATE' || data.action === 'UPDATE')
            displayName = parseUserDisplayName(data.displayName)
          if ('temporaryPassword' in data) parsePlaintextPassword(data.temporaryPassword)
        } catch {
          return { status: 'VALIDATION_FAILED' }
        }
        const credential =
          'temporaryPassword' in data ? await passwordService.hash(data.temporaryPassword) : null
        // Hashing yields; re-authorize before starting any write.
        const currentSession = authority()
        if (
          currentSession.user.id !== session.user.id ||
          currentSession.authenticatedAt !== session.authenticatedAt
        )
          return { status: 'SESSION_CHANGED' }
        return transactions.run((context): MutationData => {
          authority()
          const deployment = installation.get()
          if (deployment === null) return { status: 'UNAVAILABLE' }
          let occurredAt = context.nowUtc()
          let userId
          if (data.action === 'CREATE') {
            if (users.getByUsername(identity!.username) !== null)
              return { status: 'USERNAME_EXISTS' }
            userId = context.newEntityId()
            users.insert(context.connection, {
              id: userId,
              username: identity!.username,
              displayName: displayName!,
              role: data.role,
              credential: credential!,
              mustChangePassword: true,
              createdAt: occurredAt,
              updatedAt: occurredAt
            })
          } else {
            userId = parseEntityId(data.userId)
            const current = users.getById(userId)
            if (current === null) return { status: 'USER_NOT_FOUND' }
            if (current.updatedAt !== data.expectedUpdatedAt) return { status: 'VERSION_CONFLICT' }
            // Managing one's own account can invalidate the sole active local session.
            if (userId === session.user.id) return { status: 'SELF_CHANGE_FORBIDDEN' }
            occurredAt = parseUtcTimestamp(
              new Date(
                Math.max(Date.parse(occurredAt), Date.parse(current.updatedAt) + 1)
              ).toISOString()
            )
            if (data.action === 'UPDATE') {
              if (
                current.isActive &&
                current.role === 'LOCAL_ADMIN' &&
                (!data.isActive || data.role !== 'LOCAL_ADMIN')
              ) {
                const count = connection
                  .prepare(
                    "SELECT count(*) AS total FROM users WHERE is_active = 1 AND role = 'LOCAL_ADMIN'"
                  )
                  .get() as { total: number }
                if (count.total <= 1) return { status: 'LAST_ADMIN' }
              }
              context.connection
                .prepare(
                  `UPDATE users SET display_name = ?, role = ?, is_active = ?,
                locked_until = ?, updated_at = ? WHERE id = ? AND updated_at = ?`
                )
                .run(
                  displayName!,
                  data.role,
                  data.isActive ? 1 : 0,
                  current.lockedUntil !== null && current.lockedUntil <= occurredAt
                    ? null
                    : current.lockedUntil,
                  occurredAt,
                  userId,
                  current.updatedAt
                )
            } else if (data.action === 'RESET_PASSWORD') {
              context.connection
                .prepare(
                  `UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1,
                failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ? AND updated_at = ?`
                )
                .run(
                  credential!.passwordHash,
                  credential!.passwordSalt,
                  occurredAt,
                  userId,
                  current.updatedAt
                )
            } else {
              context.connection
                .prepare(
                  'UPDATE users SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ? AND updated_at = ?'
                )
                .run(occurredAt, userId, current.updatedAt)
            }
          }
          audit.insert(context.connection, {
            id: context.newEntityId(),
            installationId: deployment.id,
            userId: session.user.id,
            action: parseAuditActionCode(`USER_ADMIN_${data.action}`),
            entityType: parseAuditEntityType('USER'),
            entityId: userId,
            occurredAt,
            metadata:
              data.action === 'CREATE'
                ? { role: data.role, must_change_password: true }
                : data.action === 'UPDATE'
                  ? {
                      reason: data.reason,
                      role: data.role,
                      is_active: data.isActive,
                      display_name: displayName!
                    }
                  : { reason: data.reason }
          })
          return { status: 'SAVED', user: publicManagedUserSchema.parse(users.getById(userId)) }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }
}
