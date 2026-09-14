import type { SyncSnapshotDiagnostic } from '@shared/sync-snapshot-diagnostics'
import { RepositoryDataIntegrityError } from '../repository-errors'

export class SnapshotValueError extends RepositoryDataIntegrityError {
  constructor(
    readonly rule: SyncSnapshotDiagnostic['rule'],
    readonly field?: SyncSnapshotDiagnostic['field']
  ) {
    super()
  }
}

export class SnapshotMaterializationError extends RepositoryDataIntegrityError {
  constructor(readonly diagnostic: SyncSnapshotDiagnostic) {
    super()
  }
}

export function snapshotField<T>(
  field: NonNullable<SyncSnapshotDiagnostic['field']>,
  read: () => T
): T {
  try {
    return read()
  } catch (error) {
    throw new SnapshotValueError(
      error instanceof SnapshotValueError ? error.rule : 'INVALID_VALUE',
      field
    )
  }
}
