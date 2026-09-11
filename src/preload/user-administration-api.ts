import { createIpcSuccess, ipcChannels } from '@shared/ipc'
import {
  userAdministrationSearchRequestSchema,
  userAdministrationSearchResultSchema,
  userAdministrationMutationRequestSchema,
  userAdministrationMutationResultSchema,
  type UserAdministrationApi
} from '@shared/ipc/user-administration-contracts'
import type { IpcInvoke } from './authentication-api'
interface Schema<T> {
  parse(value: unknown): T
}
export function createUserAdministrationApi(invoke: IpcInvoke): UserAdministrationApi {
  async function call<Request, Result>(
    channel: string,
    request: Request,
    requestSchema: Schema<Request>,
    resultSchema: Schema<Result>
  ): Promise<Result> {
    let parsed: Request
    try {
      parsed = requestSchema.parse(request)
    } catch {
      return createIpcSuccess({ status: 'VALIDATION_FAILED' }) as Result
    }
    try {
      return resultSchema.parse(await invoke(channel, parsed))
    } catch {
      return createIpcSuccess({ status: 'UNAVAILABLE' }) as Result
    }
  }
  return Object.freeze({
    search: (request) =>
      call(
        ipcChannels.userAdministration.search,
        request,
        userAdministrationSearchRequestSchema,
        userAdministrationSearchResultSchema
      ),
    mutate: (request) =>
      call(
        ipcChannels.userAdministration.mutate,
        request,
        userAdministrationMutationRequestSchema,
        userAdministrationMutationResultSchema
      )
  } satisfies UserAdministrationApi)
}
