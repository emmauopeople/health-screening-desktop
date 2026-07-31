import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocalUserRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'
import { getErrorType } from '@main/foundation/error-type'
import { createPasswordCredentialService } from '@main/security'

import { createLocalForcedPasswordChangeService } from './forced-password-change-service'
import { LocalForcedPasswordChangeCompositionError } from './forced-password-change-errors'
import type { LocalForcedPasswordChangeService } from './forced-password-change-types'

export interface ProductionLocalForcedPasswordChangeServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionLocalForcedPasswordChangeService({
  connection,
  logger
}: ProductionLocalForcedPasswordChangeServiceOptions): LocalForcedPasswordChangeService {
  try {
    const passwordCredentialService = createPasswordCredentialService()
    const clock = createSystemUtcClock()

    return createLocalForcedPasswordChangeService({
      installationRepository: createInstallationRepository(connection),
      localUserRepository: createLocalUserRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      passwordCredentialService,
      transactionExecutor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createSystemEntityIdGenerator(),
        clock,
        logger
      }),
      clock
    })
  } catch (error) {
    if (error instanceof LocalForcedPasswordChangeCompositionError) {
      throw new LocalForcedPasswordChangeCompositionError(error.errorType)
    }

    throw new LocalForcedPasswordChangeCompositionError(getErrorType(error))
  }
}
