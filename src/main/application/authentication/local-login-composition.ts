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

import { createLocalLoginAuthenticationService } from './local-login-authentication-service'
import { LocalLoginCompositionError } from './local-login-errors'
import type { LocalLoginAuthenticationService } from './local-login-types'

const dummyPassword = 'LocalDummyPassw0rd!'

export interface ProductionLocalLoginAuthenticationServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export async function createProductionLocalLoginAuthenticationService({
  connection,
  logger
}: ProductionLocalLoginAuthenticationServiceOptions): Promise<LocalLoginAuthenticationService> {
  try {
    const passwordCredentialService = createPasswordCredentialService()
    const clock = createSystemUtcClock()
    const dummyCredential = await passwordCredentialService.hash(dummyPassword)

    return createLocalLoginAuthenticationService({
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
      clock,
      dummyCredential
    })
  } catch (error) {
    if (error instanceof LocalLoginCompositionError) {
      throw new LocalLoginCompositionError(error.errorType)
    }

    throw new LocalLoginCompositionError(getErrorType(error))
  }
}
