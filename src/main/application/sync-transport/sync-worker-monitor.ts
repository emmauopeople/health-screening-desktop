import {
  syncWorkerCheckSchema,
  type SyncWorkerCheck
} from '@shared/ipc/sync-administration-contracts'

export interface SyncWorkerMonitor {
  record(status: SyncWorkerCheck['status'], phase: SyncWorkerCheck['phase']): void
  getLatest(): Readonly<SyncWorkerCheck> | undefined
  clear(): void
}

// Process-local diagnostics only. Never accept errors, credentials or clinical payloads.
export function createSyncWorkerMonitor(
  now = (): string => new Date().toISOString()
): SyncWorkerMonitor {
  let latest: Readonly<SyncWorkerCheck> | undefined
  return Object.freeze({
    record(status: SyncWorkerCheck['status'], phase: SyncWorkerCheck['phase']): void {
      latest = Object.freeze(syncWorkerCheckSchema.parse({ checkedAt: now(), status, phase }))
    },
    getLatest: () => latest,
    clear(): void {
      latest = undefined
    }
  })
}
