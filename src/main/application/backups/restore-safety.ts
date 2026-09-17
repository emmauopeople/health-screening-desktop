import Database from 'better-sqlite3'

export class RestoreRejected extends Error {
  constructor(
    readonly status: 'DIFFERENT_INSTALLATION' | 'SYNC_RECOVERY_REQUIRED' | 'RESTORE_EXPIRED'
  ) {
    super(status)
  }
}

/** Read-only guard: restoring transport counters needs a separate reconciliation workflow. */
export function assertLocalRestoreAllowed(
  database: Database.Database,
  installationId: string
): void {
  const installation = database.prepare('SELECT id FROM installation').get() as
    { id: string } | undefined
  if (installation?.id !== installationId) throw new RestoreRejected('DIFFERENT_INSTALLATION')
  if (
    database.prepare("SELECT 1 FROM app_settings WHERE key LIKE 'sync.%' LIMIT 1").get() ||
    database.prepare('SELECT 1 FROM sync_transport_batches LIMIT 1').get() ||
    database.prepare('SELECT 1 FROM sync_attempts LIMIT 1').get() ||
    database.prepare('SELECT 1 FROM sync_patient_identity_links LIMIT 1').get() ||
    database.prepare('SELECT 1 FROM sync_identity_resolution_deliveries LIMIT 1').get() ||
    database.prepare('SELECT 1 FROM sync_transport_resource_mappings LIMIT 1').get() ||
    database
      .prepare("SELECT 1 FROM sync_outbox WHERE status <> 'PENDING' OR attempt_count <> 0 LIMIT 1")
      .get()
  )
    throw new RestoreRejected('SYNC_RECOVERY_REQUIRED')
}

export function assertSnapshotRestoreAllowed(path: string, installationId: string): void {
  const database = new Database(path, { readonly: true, fileMustExist: true })
  try {
    database.pragma('trusted_schema = OFF')
    assertLocalRestoreAllowed(database, installationId)
    if (
      !database
        .prepare("SELECT 1 FROM users WHERE role = 'LOCAL_ADMIN' AND is_active = 1 LIMIT 1")
        .get()
    )
      throw new RestoreRejected('RESTORE_EXPIRED')
  } finally {
    database.close()
  }
}
