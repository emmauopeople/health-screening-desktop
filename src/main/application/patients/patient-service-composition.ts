import type Database from 'better-sqlite3'

import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createPatientRepository,
  type DatabaseTransactionLogger
} from '@main/database'
import { createSystemEntityIdGenerator, createSystemUtcClock } from '@main/foundation'

import { createPatientRegistryService } from './patient-service'
import type { PatientRegistryService } from './patient-service-types'

export interface ProductionPatientRegistryServiceOptions {
  readonly connection: Database.Database
  readonly logger?: DatabaseTransactionLogger
}

export function createProductionPatientRegistryService({
  connection,
  logger
}: ProductionPatientRegistryServiceOptions): PatientRegistryService {
  return createPatientRegistryService({
    installationRepository: createInstallationRepository(connection),
    patientRepository: createPatientRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSystemEntityIdGenerator(),
      clock: createSystemUtcClock(),
      logger
    })
  })
}
