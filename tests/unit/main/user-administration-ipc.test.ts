import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import { createUserAdministrationHandlers } from '@main/ipc/handlers/user-administration-handlers'
import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'
import type { UserAdministrationService } from '@main/application/user-administration/user-administration-service'
const frame = { url: 'http://localhost:5173/' }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
const request = { query: '', status: 'ALL' as const, page: 1 }
const mutation = {
  action: 'CREATE' as const,
  username: 'nurse',
  displayName: 'Nurse',
  role: 'NURSE' as const,
  temporaryPassword: 'temporary-pass-123'
}
function harness(): {
  service: UserAdministrationService
  handlers: ReturnType<typeof createUserAdministrationHandlers>
} {
  const service: UserAdministrationService = {
    search: vi.fn<UserAdministrationService['search']>(() => ({
      status: 'LOADED',
      items: [],
      total: 0,
      page: 1,
      currentUserId: '69000000-0000-4000-8000-000000000002'
    })),
    mutate: vi.fn<UserAdministrationService['mutate']>(async () => ({ status: 'USERNAME_EXISTS' }))
  }
  return {
    service,
    handlers: createUserAdministrationHandlers({
      service,
      navigationPolicy: createDevelopmentNavigationPolicy(frame.url)
    })
  }
}
describe('user administration IPC and preload boundary', () => {
  it('passes exact validated requests on fixed channels through a frozen API', async () => {
    const { service, handlers } = harness()
    const invoke = vi.fn((channel: string, data: unknown) =>
      channel === ipcChannels.userAdministration.search
        ? handlers.search(event, data)
        : handlers.mutate(event, data)
    )
    const api = createHealthScreeningApi(invoke).userAdministration!
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.keys(api)).toEqual(['search', 'mutate'])
    expect(await api.search(request)).toMatchObject({ ok: true, data: { status: 'LOADED' } })
    expect(await api.mutate(mutation)).toEqual(createIpcSuccess({ status: 'USERNAME_EXISTS' }))
    expect(invoke).toHaveBeenCalledWith(ipcChannels.userAdministration.mutate, mutation)
    expect(service.mutate).toHaveBeenCalledWith(mutation)
  })
  it('rejects unsafe senders and overposted privileges before service execution', async () => {
    const { service, handlers } = harness()
    const evil = { url: 'https://evil.invalid' }
    expect(
      await handlers.mutate({ sender: { mainFrame: evil }, senderFrame: evil }, mutation)
    ).toMatchObject({ ok: false, error: { code: 'IPC_FORBIDDEN' } })
    expect(await handlers.mutate(event, { ...mutation, actorId: 'forged' })).toEqual(
      createIpcSuccess({ status: 'VALIDATION_FAILED' })
    )
    expect(service.mutate).not.toHaveBeenCalled()
    const invoke = vi.fn()
    expect(
      await createHealthScreeningApi(invoke).userAdministration!.search({ ...request, page: -1 })
    ).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(invoke).not.toHaveBeenCalled()
  })
  it('contains malformed responses, leaked fields, transport failures and internal exceptions', async () => {
    const { service, handlers } = harness()
    vi.mocked(service.search).mockReturnValue({ status: 'LOADED', passwordHash: 'secret' } as never)
    expect(await handlers.search(event, request)).toEqual(
      createIpcSuccess({ status: 'UNAVAILABLE' })
    )
    vi.mocked(service.mutate).mockRejectedValue(Error('database secret'))
    expect(await handlers.mutate(event, mutation)).toEqual(
      createIpcSuccess({ status: 'UNAVAILABLE' })
    )
    const invoke = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { status: 'SAVED', passwordHash: 'secret' } })
    const api = createHealthScreeningApi(invoke).userAdministration!
    expect(await api.mutate(mutation)).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    invoke.mockRejectedValue(Error('transport'))
    expect(await api.search(request)).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
  })
})
