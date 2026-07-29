export type DatabaseStatus = 'ready' | 'unavailable'

export interface DatabaseHealthProvider {
  getStatus(): DatabaseStatus
}

export interface DatabaseStatusRuntime {
  getStatus(): DatabaseStatus
}

export function createDatabaseHealthProvider(
  runtime: DatabaseStatusRuntime
): DatabaseHealthProvider {
  return {
    getStatus: () => runtime.getStatus()
  }
}
