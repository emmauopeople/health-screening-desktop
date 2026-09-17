import { ipcChannels } from '@shared/ipc/channels'
import { createIpcFailure } from '@shared/ipc/result'
import {
  protocolResultSchema,
  type ProtocolApi,
  type ProtocolResult
} from '@shared/ipc/protocol-contracts'
import type { IpcInvoke } from './health-screening-api'
export function createProtocolApi(invoke: IpcInvoke): ProtocolApi {
  return Object.freeze({
    async get(): Promise<ProtocolResult> {
      try {
        const result = protocolResultSchema.safeParse(await invoke(ipcChannels.protocols.get, {}))
        return result.success ? result.data : createIpcFailure('IPC_UNAVAILABLE')
      } catch {
        return createIpcFailure('IPC_UNAVAILABLE')
      }
    }
  })
}
