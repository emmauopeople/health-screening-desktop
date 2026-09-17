import { describe, expect, it, vi } from 'vitest'
import { createBackupApi } from '@preload/backup-api'
import { ipcChannels } from '@shared/ipc/channels'
const request = { password: 'a-long-backup-passphrase' }
describe('backup preload API', () => {
  it('exposes only fixed backup and restore methods', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: { status: 'CANCELLED' } })
    const api = createBackupApi(invoke)
    expect(Object.keys(api)).toEqual([
      'create',
      'inspect',
      'prepareRestore',
      'restore',
      'discardRestore'
    ])
    expect(Object.isFrozen(api)).toBe(true)
    await api.create(request)
    await api.inspect(request)
    expect(invoke.mock.calls).toEqual([
      [ipcChannels.backups.create, request],
      [ipcChannels.backups.inspect, request]
    ])
  })
  it('does not send invalid passwords or renderer-provided paths', async () => {
    const invoke = vi.fn()
    const api = createBackupApi(invoke)
    expect(await api.create({ password: 'short' })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' }
    })
    expect(
      await api.inspect({ ...request, filePath: '/private/path' } as typeof request)
    ).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })
    expect(invoke).not.toHaveBeenCalled()
  })
  it('contains rejected IPC and malformed replies without exposing secrets', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error(request.password))
      .mockResolvedValueOnce({ ok: true, data: { status: 'CANCELLED', path: '/private/path' } })
    const api = createBackupApi(invoke)
    for (const method of ['create', 'inspect'] as const)
      expect(await api[method](request)).toMatchObject({
        ok: false,
        error: { code: 'IPC_UNAVAILABLE' }
      })
  })
})

it('validates restore confirmation and token requests before IPC', async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true, data: { status: 'CANCELLED' } })
  const api = createBackupApi(invoke)
  const token = '11111111-1111-4111-8111-111111111111'
  for (const value of [
    { token },
    { token, confirmation: 'YES' },
    { token, confirmation: 'RESTORE', path: '/injected' },
    { token: '../escape', confirmation: 'RESTORE' }
  ]) {
    expect(await api.restore(value as never)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' }
    })
  }
  expect(invoke).not.toHaveBeenCalled()
  await api.prepareRestore(request)
  await api.restore({ token, confirmation: 'RESTORE' })
  await api.discardRestore({ token })
  expect(invoke.mock.calls).toEqual([
    [ipcChannels.backups.prepareRestore, request],
    [ipcChannels.backups.restore, { token, confirmation: 'RESTORE' }],
    [ipcChannels.backups.discardRestore, { token }]
  ])
})
