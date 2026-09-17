import type { ProtocolService } from '@main/application/protocols/protocol-service'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcFailure, createIpcSuccess } from '@shared/ipc/result'
import {
  protocolGetRequestSchema,
  protocolResultSchema,
  type ProtocolResult
} from '@shared/ipc/protocol-contracts'

export interface ProtocolIpcDependencies {
  navigationPolicy: NavigationPolicy
  service: ProtocolService
}
export function createProtocolHandler({
  navigationPolicy,
  service
}: ProtocolIpcDependencies): (event: IpcSenderValidationEvent, request: unknown) => ProtocolResult {
  return (event, request) => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) return createIpcFailure('IPC_FORBIDDEN')
    try {
      if (!protocolGetRequestSchema.safeParse(request).success)
        return createIpcFailure('VALIDATION_FAILED')
      return protocolResultSchema.parse(createIpcSuccess(service.get()))
    } catch {
      return createIpcSuccess({ status: 'UNAVAILABLE' })
    }
  }
}
