import { Buffer } from 'node:buffer'

import {
  parseAuditActionCode,
  parseAuditEntityType,
  RepositoryDataIntegrityError
} from '@main/database'
import type { EntityId } from '@main/foundation/entity-id'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '../authentication/session'
import type {
  ConfigureSyncAdministrationResult,
  GetSyncAdministrationStateResult,
  SyncAdministrationActivity,
  SyncAdministrationService,
  SyncAdministrationServiceDependencies
} from './sync-administration-types'
import { parseSyncConfiguration } from './sync-transport-validation'

const adminRoles = Object.freeze(['LOCAL_ADMIN'] as const)
const configuredAction = parseAuditActionCode('SYNC_TRANSPORT_CONFIGURED')
const updatedAction = parseAuditActionCode('SYNC_TRANSPORT_UPDATED')
const installationEntityType = parseAuditEntityType('INSTALLATION')

export function createSyncAdministrationService(
  dependencies: SyncAdministrationServiceDependencies
): SyncAdministrationService {
  return Object.freeze({
    getState(): GetSyncAdministrationStateResult {
      const authorization = authorize(dependencies)
      if (authorization.status !== 'AUTHORIZED') return stateFailure(authorization.status)

      try {
        const configuration = dependencies.repository.getConfiguration()
        const storedStatus = dependencies.repository.getOperationalStatus()
        return Object.freeze({
          status: 'READY' as const,
          configuration:
            configuration === null
              ? Object.freeze({ status: 'NOT_CONFIGURED' as const })
              : Object.freeze({
                  status: 'CONFIGURED' as const,
                  apiBaseUrl: configuration.apiBaseUrl,
                  tokenPrefix: configuration.tokenPrefix,
                  updatedAt: configuration.updatedAt
                }),
          activity: toActivity(configuration !== null, storedStatus)
        })
      } catch {
        return stateFailure('UNAVAILABLE')
      }
    },

    configure(request: unknown): ConfigureSyncAdministrationResult {
      const authorization = authorize(dependencies)
      if (authorization.status !== 'AUTHORIZED') return configureFailure(authorization.status)

      let parsed: ReturnType<typeof parseSyncConfiguration>
      try {
        parsed = parseSyncConfiguration(request)
      } catch {
        return configureFailure('VALIDATION_FAILED')
      }
      if (!dependencies.credentialProtector.isAvailable()) {
        return configureFailure('PROTECTION_UNAVAILABLE')
      }

      try {
        const protectedToken = Buffer.from(
          dependencies.credentialProtector.protect(parsed.installationToken)
        ).toString('base64')
        return dependencies.transactionExecutor.run((context) => {
          const installation = dependencies.installationRepository.get()
          if (installation === null) throw new RepositoryDataIntegrityError()
          const existing = dependencies.repository.getConfiguration()
          const updatedAt = context.nowUtc()
          dependencies.repository.upsertConfiguration(context.connection, {
            apiBaseUrl: parsed.apiBaseUrl,
            protectedToken,
            tokenPrefix: parsed.tokenPrefix,
            updatedAt
          })
          dependencies.auditEventRepository.insert(context.connection, {
            id: context.newEntityId(),
            installationId: installation.id,
            userId: authorization.userId,
            action: existing === null ? configuredAction : updatedAction,
            entityType: installationEntityType,
            entityId: installation.id,
            occurredAt: updatedAt,
            metadata: Object.freeze({
              api_base_url: parsed.apiBaseUrl,
              credential_rotated: true,
              token_prefix: parsed.tokenPrefix
            })
          })
          return Object.freeze({
            status: 'CONFIGURED' as const,
            configuration: Object.freeze({
              status: 'CONFIGURED' as const,
              apiBaseUrl: parsed.apiBaseUrl,
              tokenPrefix: parsed.tokenPrefix,
              updatedAt
            })
          })
        })
      } catch {
        return configureFailure('UNAVAILABLE')
      }
    }
  })
}

function toActivity(
  configured: boolean,
  stored: ReturnType<SyncAdministrationServiceDependencies['repository']['getOperationalStatus']>
): SyncAdministrationActivity {
  const state = !configured
    ? 'NOT_CONFIGURED'
    : stored.inFlightBatchCount > 0
      ? 'SYNCHRONIZING'
      : stored.nextRetryAt !== null
        ? 'RETRY_SCHEDULED'
        : stored.pendingChangeCount > 0 ||
            stored.queuedBatchCount > 0 ||
            stored.pendingAcknowledgmentCount > 0
          ? 'PENDING'
          : 'UP_TO_DATE'
  return Object.freeze({
    state,
    pendingChangeCount: stored.pendingChangeCount,
    pendingAcknowledgmentCount: stored.pendingAcknowledgmentCount,
    lastCompletedBatchAt: stored.lastCompletedBatchAt,
    nextRetryAt: stored.nextRetryAt
  })
}

type AuthorizationResult =
  | { readonly status: 'AUTHORIZED'; readonly userId: EntityId }
  | { readonly status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE' }

function authorize(dependencies: SyncAdministrationServiceDependencies): AuthorizationResult {
  try {
    const context = dependencies.authenticationSessionService.requireAnyRole(adminRoles)
    return Object.freeze({
      status: 'AUTHORIZED' as const,
      userId: context.user.id
    })
  } catch (error) {
    if (
      error instanceof LocalSessionUnauthenticatedError ||
      error instanceof LocalSessionLockedError ||
      error instanceof LocalSessionPasswordChangeRequiredError
    ) {
      return Object.freeze({ status: 'AUTHENTICATION_REQUIRED' as const })
    }
    if (error instanceof LocalSessionAuthorizationError) {
      return Object.freeze({ status: 'FORBIDDEN' as const })
    }
    return Object.freeze({ status: 'UNAVAILABLE' as const })
  }
}

function stateFailure(
  status: 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE'
): GetSyncAdministrationStateResult {
  return Object.freeze({ status })
}

function configureFailure(
  status: Exclude<ConfigureSyncAdministrationResult['status'], 'CONFIGURED'>
): ConfigureSyncAdministrationResult {
  return Object.freeze({ status })
}
