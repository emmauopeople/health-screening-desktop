import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  type LocalAuthenticationSessionService
} from '@main/application/authentication/session'
import { createLocalUserRepository } from '@main/database'
import { SCREENING_BP_PROTOCOL_V1 } from '@shared/screening-bp-protocol'
import { activeProtocolSchema, type ProtocolData } from '@shared/ipc/protocol-contracts'

const storedProtocolSchema = activeProtocolSchema
  .omit({ rulesMatch: true })
  .extend({
    configuration: z.string().max(65_536),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
const expectedBp = Object.freeze({
  rulesetKey: SCREENING_BP_PROTOCOL_V1.key,
  rulesetVersion: SCREENING_BP_PROTOCOL_V1.version,
  ...SCREENING_BP_PROTOCOL_V1.configuration
})
const configurationSchema = z.object({ bpScreening: z.record(z.string(), z.unknown()) })
export interface ProtocolService {
  get(): ProtocolData
}
export function createProtocolService({
  connection,
  authenticationSessionService
}: {
  connection: Database.Database
  authenticationSessionService: LocalAuthenticationSessionService
}): ProtocolService {
  const users = createLocalUserRepository(connection)
  return Object.freeze({
    get(): ProtocolData {
      try {
        const actor = authenticationSessionService.requireAnyRole(['LOCAL_ADMIN'])
        const user = users.getById(actor.user.id)
        if (
          !user?.isActive ||
          user.role !== 'LOCAL_ADMIN' ||
          user.mustChangePassword ||
          (user.lockedUntil !== null && Date.parse(user.lockedUntil) > Date.now())
        )
          return { status: 'FORBIDDEN' }
        // Read only; two rows detect corruption despite the normal unique-active index.
        const rows = connection
          .prepare(
            `SELECT protocol_key AS key, version_label AS version,
          effective_at AS effectiveAt, checksum,
          CASE WHEN length(configuration_json) <= 65536 THEN configuration_json ELSE NULL END AS configuration
          FROM protocol_versions WHERE status = 'ACTIVE' ORDER BY id LIMIT 2`
          )
          .all()
        if (rows.length === 0) return { status: 'NO_ACTIVE_PROTOCOL' }
        if (rows.length !== 1) return { status: 'UNAVAILABLE' }
        const row = storedProtocolSchema.parse(rows[0])
        if (createHash('sha256').update(row.configuration).digest('hex') !== row.checksum)
          return { status: 'UNAVAILABLE' }
        const configuration = configurationSchema.safeParse(JSON.parse(row.configuration))
        const actual = configuration.success ? configuration.data.bpScreening : null
        const rulesMatch =
          actual !== null &&
          Object.keys(actual).length === Object.keys(expectedBp).length &&
          Object.entries(expectedBp).every(([key, value]) => actual[key] === value)
        return {
          status: 'LOADED',
          active: { key: row.key, version: row.version, effectiveAt: row.effectiveAt, rulesMatch }
        }
      } catch (error) {
        if (
          error instanceof LocalSessionUnauthenticatedError ||
          error instanceof LocalSessionLockedError ||
          error instanceof LocalSessionPasswordChangeRequiredError
        )
          return { status: 'AUTHENTICATION_REQUIRED' }
        if (error instanceof LocalSessionAuthorizationError) return { status: 'FORBIDDEN' }
        return { status: 'UNAVAILABLE' }
      }
    }
  })
}
