import { DatabaseTransactionStateError } from './transaction-types'
import type { DatabaseTransactionConnection } from './transaction-types'

const activeTransactionConnections = new WeakSet<DatabaseTransactionConnection>()

export function registerDatabaseTransactionConnection(
  connection: DatabaseTransactionConnection
): void {
  activeTransactionConnections.add(connection)
}

export function assertActiveDatabaseTransactionConnection(
  connection: DatabaseTransactionConnection
): void {
  if (!activeTransactionConnections.has(connection)) {
    throw new DatabaseTransactionStateError()
  }

  if (!connection.open || !connection.inTransaction) {
    throw new DatabaseTransactionStateError()
  }
}
