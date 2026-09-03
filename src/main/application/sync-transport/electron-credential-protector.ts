import { safeStorage } from 'electron'

import type { SyncCredentialProtector } from './sync-transport-types'

export function createElectronSyncCredentialProtector(): SyncCredentialProtector {
  return Object.freeze({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    protect: (secret: string) => safeStorage.encryptString(secret),
    unprotect: (ciphertext: Uint8Array) => safeStorage.decryptString(Buffer.from(ciphertext))
  })
}
