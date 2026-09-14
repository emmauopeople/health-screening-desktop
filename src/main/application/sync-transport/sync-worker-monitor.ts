import type { SyncSnapshotDiagnostic } from '@shared/sync-snapshot-diagnostics'
import {
  syncWorkerCheckSchema,
  type SyncWorkerCheck
} from '@shared/ipc/sync-administration-contracts'

export interface SyncWorkerMonitor {
  record(
    status: SyncWorkerCheck['status'],
    phase: SyncWorkerCheck['phase'],
    diagnostic?: SyncSnapshotDiagnostic
  ): void
  getLatest(): Readonly<SyncWorkerCheck> | undefined
  clear(): void
}

// Process-local diagnostics only. Never accept errors, credentials or clinical payloads.
export function createSyncWorkerMonitor(
  now = (): string => new Date().toISOString()
): SyncWorkerMonitor {
  let latest: Readonly<SyncWorkerCheck> | undefined
  return Object.freeze({
    record(
      status: SyncWorkerCheck['status'],
      phase: SyncWorkerCheck['phase'],
      diagnostic?: SyncSnapshotDiagnostic
    ): void {
      const detail =
        status === 'UNAVAILABLE' && phase === 'SNAPSHOT'
          ? (diagnostic ?? (latest?.phase === 'SNAPSHOT' ? latest.diagnostic : undefined))
          : undefined
      latest = Object.freeze(
        syncWorkerCheckSchema.parse({
          checkedAt: now(),
          status,
          phase,
          ...(detail === undefined ? {} : { diagnostic: detail })
        })
      )
    },
    getLatest: () => latest,
    clear(): void {
      latest = undefined
    }
  })
}
