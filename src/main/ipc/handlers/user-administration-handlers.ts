import type { UserAdministrationService } from '@main/application/user-administration/user-administration-service'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcFailure, createIpcSuccess } from '@shared/ipc'
import {
  userAdministrationSearchRequestSchema,
  userAdministrationSearchResultSchema,
  userAdministrationMutationRequestSchema,
  userAdministrationMutationResultSchema,
  type UserAdministrationSearchResult,
  type UserAdministrationMutationResult
} from '@shared/ipc/user-administration-contracts'

export interface UserAdministrationIpcDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly service: UserAdministrationService
}
interface Schema<T> {
  parse(value: unknown): T
}
export function createUserAdministrationHandlers({
  navigationPolicy,
  service
}: UserAdministrationIpcDependencies): {
  search(event: IpcSenderValidationEvent, request: unknown): Promise<UserAdministrationSearchResult>
  mutate(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<UserAdministrationMutationResult>
} {
  async function handle<Request, Result>(
    event: IpcSenderValidationEvent,
    request: unknown,
    requestSchema: Schema<Request>,
    resultSchema: Schema<Result>,
    invoke: (request: Request) => unknown
  ): Promise<Result> {
    if (!isIpcSenderAllowed(event, navigationPolicy))
      return createIpcFailure('IPC_FORBIDDEN') as Result
    let parsed: Request
    try {
      parsed = requestSchema.parse(request)
    } catch {
      return createIpcSuccess({ status: 'VALIDATION_FAILED' }) as Result
    }
    try {
      return resultSchema.parse(createIpcSuccess(await invoke(parsed)))
    } catch {
      return createIpcSuccess({ status: 'UNAVAILABLE' }) as Result
    }
  }
  return Object.freeze({
    search: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<UserAdministrationSearchResult> =>
      handle(
        event,
        request,
        userAdministrationSearchRequestSchema,
        userAdministrationSearchResultSchema,
        service.search
      ),
    mutate: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<UserAdministrationMutationResult> =>
      handle(
        event,
        request,
        userAdministrationMutationRequestSchema,
        userAdministrationMutationResultSchema,
        service.mutate
      )
  })
}
