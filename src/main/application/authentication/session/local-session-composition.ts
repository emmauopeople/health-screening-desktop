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

import { createLocalForcedPasswordChangeService } from '../forced-password-change-service'
import { createLocalLoginAuthenticationService } from '../local-login-authentication-service'
import { LocalSessionCompositionError } from './local-session-errors'
import { createLocalAuthenticationSessionService } from './local-session-service'
import type { LocalAuthenticationSessionService } from './local-session-types'

const dummyPassword = 'LocalDummyPassw0rd!'

export interface ProductionLocalAuthenticationSessionServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export async function createProductionLocalAuthenticationSessionService({
  connection,
  logger
}: ProductionLocalAuthenticationSessionServiceOptions): Promise<LocalAuthenticationSessionService> {
  try {
    const passwordCredentialService = createPasswordCredentialService()
    const clock = createSystemUtcClock()
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock,
      logger
    })
    const installationRepository = createInstallationRepository(connection)
    const localUserRepository = createLocalUserRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const dummyCredential = await passwordCredentialService.hash(dummyPassword)
    const loginService = createLocalLoginAuthenticationService({
      installationRepository,
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock,
      dummyCredential
    })
    const forcedPasswordChangeService = createLocalForcedPasswordChangeService({
      installationRepository,
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock
    })

    return createLocalAuthenticationSessionService({
      loginService,
      forcedPasswordChangeService,
      clock
    })
  } catch (error) {
    if (error instanceof LocalSessionCompositionError) {
      throw new LocalSessionCompositionError(error.errorType)
    }

    throw new LocalSessionCompositionError(getErrorType(error))
  }
}
