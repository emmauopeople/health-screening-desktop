import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import { createBackupHandlers } from '@main/ipc/handlers/backup-handlers'
import type { BackupService } from '@main/application/backups/backup-service'
import type { BackupActionData } from '@shared/ipc/backup-contracts'

const frame = { url: 'http://localhost:5173/' }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
const request = { password: 'a-long-backup-passphrase' }
function fixture(): { service: BackupService; handlers: ReturnType<typeof createBackupHandlers> } {
  const service: BackupService = {
    create: vi.fn(async () => ({ status: 'CANCELLED' as const })),
    inspect: vi.fn(async () => ({ status: 'CANCELLED' as const })),
    prepareRestore: async () => ({ status: 'UNAVAILABLE' as const }),
    restore: async () => ({ status: 'UNAVAILABLE' as const }),
    discardRestore: async () => ({ status: 'UNAVAILABLE' as const })
  }
  return {
    service,
    handlers: createBackupHandlers({
      navigationPolicy: createDevelopmentNavigationPolicy(frame.url),
      service
    })
  }
}
describe('backup IPC isolation', () => {
  it.each(['create', 'inspect'] as const)(
    'passes validated %s requests to the service',
    async (method) => {
      const { service, handlers } = fixture()
      expect(await handlers[method](event, request)).toEqual({
        ok: true,
        data: { status: 'CANCELLED' }
      })
      expect(service[method]).toHaveBeenCalledWith(request)
    }
  )
  it('rejects untrusted windows, child frames, and missing frames before invoking the service', async () => {
    const { service, handlers } = fixture()
    const foreign = { url: 'https://untrusted.invalid' }
    for (const candidate of [
      { sender: { mainFrame: foreign }, senderFrame: foreign },
      { sender: { mainFrame: frame }, senderFrame: { ...frame } },
      { sender: { mainFrame: frame }, senderFrame: null }
    ])
      expect(await handlers.create(candidate, request)).toMatchObject({
        ok: false,
        error: { code: 'IPC_FORBIDDEN' }
      })
    expect(service.create).not.toHaveBeenCalled()
  })
  it('rejects injected file paths, roles, weak passwords and throwing accessors', async () => {
    const { service, handlers } = fixture()
    for (const candidate of [
      { ...request, path: 'private-path' },
      { ...request, role: 'LOCAL_ADMIN' },
      { password: 'short' },
      {
        get password() {
          throw new Error('private-path')
        }
      }
    ]) {
      const result = await handlers.create(event, candidate)
      expect(JSON.stringify(result)).not.toContain('private-path')
      expect(result).toMatchObject({
        ok: true,
        data: { status: expect.stringMatching(/VALIDATION_FAILED|UNAVAILABLE/u) }
      })
    }
    expect(service.create).not.toHaveBeenCalled()
  })
  it('contains exceptions and rejects result fields that could leak paths or secrets', async () => {
    const { service, handlers } = fixture()
    vi.mocked(service.create).mockRejectedValueOnce(new Error(request.password + '/private/path'))
    expect(await handlers.create(event, request)).toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
    vi.mocked(service.create).mockResolvedValueOnce({
      status: 'CANCELLED',
      password: request.password
    } as BackupActionData)
    expect(await handlers.create(event, request)).toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
  })
})

it('contains restore endpoints, rejects injected paths and requires literal confirmation', async () => {
  const { handlers, service } = fixture()
  const token = '11111111-1111-4111-8111-111111111111'
  const foreign = { url: 'https://untrusted.invalid' }
  for (const method of ['prepareRestore', 'restore', 'discardRestore'] as const) {
    expect(
      await handlers[method]({ sender: { mainFrame: foreign }, senderFrame: foreign }, {})
    ).toMatchObject({ ok: false, error: { code: 'IPC_FORBIDDEN' } })
  }
  expect(await handlers.restore(event, { token, confirmation: 'YES' })).toMatchObject({
    ok: true,
    data: { status: 'VALIDATION_FAILED' }
  })
  expect(
    await handlers.restore(event, { token, confirmation: 'RESTORE', path: '/private' })
  ).toMatchObject({ ok: true, data: { status: 'VALIDATION_FAILED' } })
  service.restore = vi.fn<BackupService['restore']>(async () => ({ status: 'RESTARTING' }))
  const bound = createBackupHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy(frame.url),
    service
  })
  expect(await bound.restore(event, { token, confirmation: 'RESTORE' })).toEqual({
    ok: true,
    data: { status: 'RESTARTING' }
  })
  expect(service.restore).toHaveBeenCalledWith({ token, confirmation: 'RESTORE' })
})
