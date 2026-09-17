// @vitest-environment jsdom
/// <reference lib="dom" />
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createIpcSuccess } from '@shared/ipc'
import type { BackupApi, BackupMetadata, BackupActionResult } from '@shared/ipc/backup-contracts'
import { BackupRestoreWorkspace } from '../../../src/renderer/src/app/administration/BackupRestoreWorkspace'
import type { WorkspaceNavigationGuard } from '../../../src/renderer/src/app/shell/application-shell-types'

const password = 'a-long-backup-password'
const token = '11111111-1111-4111-8111-111111111111'
const metadata: BackupMetadata = {
  formatVersion: 1,
  createdAt: '2026-09-17T10:00:00.000Z',
  applicationVersion: '1.0.0',
  schemaVersion: 24,
  installationId: token,
  deploymentName: 'Community clinic',
  timeZone: 'Africa/Douala',
  counts: { patients: 12, encounters: 25, referrals: 4, users: 2 },
  credentialScope: 'ORIGINAL_OS_PROFILE'
}
let root: Root
let container: HTMLElement
let api: BackupApi
const authenticate = vi.fn()
const guard = vi.fn<(value: WorkspaceNavigationGuard | null) => void>()
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  api = {
    create: vi.fn<BackupApi['create']>(async () => createIpcSuccess({ status: 'SAVED', metadata })),
    inspect: vi.fn<BackupApi['inspect']>(async () =>
      createIpcSuccess({ status: 'VERIFIED', metadata })
    ),
    prepareRestore: vi.fn<BackupApi['prepareRestore']>(async () =>
      createIpcSuccess({ status: 'RESTORE_READY', metadata, token })
    ),
    restore: vi.fn<BackupApi['restore']>(async () => createIpcSuccess({ status: 'RESTARTING' })),
    discardRestore: vi.fn<BackupApi['discardRestore']>(async () =>
      createIpcSuccess({ status: 'CANCELLED' })
    )
  }
  authenticate.mockReset()
  guard.mockReset()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})
async function mount(role: 'LOCAL_ADMIN' | 'NURSE' = 'LOCAL_ADMIN'): Promise<void> {
  await act(async () =>
    root.render(
      createElement(BackupRestoreWorkspace, {
        api,
        userRole: role,
        headingId: 'backup-heading',
        headingRef: { current: null },
        onAuthenticationFailure: authenticate,
        registerNavigationGuard: guard
      })
    )
  )
}
async function input(id: string, value: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function button(text: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!result) throw Error(`Missing button ${text}`)
  return result
}
async function click(text: string): Promise<void> {
  await act(async () => button(text).click())
}
async function prepare(): Promise<void> {
  await input('backup-open-password', password)
  await click('Review backup for restore')
}

describe('Backup / Restore workspace', () => {
  it('confirms the password before opening a save dialog and explains external drives', async () => {
    await mount()
    expect(container.textContent).toContain('USB drive or an external hard drive')
    await input('backup-password', password)
    await input('backup-confirmation', 'another-long-password')
    await click('Choose where to save')
    expect(api.create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('passwords do not match')
    await input('backup-confirmation', password)
    await click('Choose where to save')
    expect(api.create).toHaveBeenCalledWith({ password })
    expect(container.textContent).toContain('Encrypted backup saved')
    expect(container.textContent).toContain('Community clinic')
    expect(container.querySelector<HTMLInputElement>('#backup-password')!.value).toBe('')
  })
  it('verifies a backup without authorizing restoration', async () => {
    await mount()
    await input('backup-open-password', password)
    await click('Choose and verify backup')
    expect(api.inspect).toHaveBeenCalledWith({ password })
    expect(container.textContent).toContain('Backup verified')
    expect(container.textContent).toContain('Encounters25')
    expect(container.textContent).not.toContain('Restore and restart')
    expect(api.restore).not.toHaveBeenCalled()
  })
  it('requires review and explicit acknowledgment before restore and blocks navigation during restart', async () => {
    await mount()
    await prepare()
    expect(document.activeElement?.textContent).toBe('Review before restoring')
    expect(button('Restore and restart').disabled).toBe(true)
    await click('Restore and restart')
    expect(api.restore).not.toHaveBeenCalled()
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
    )
    await click('Restore and restart')
    expect(api.restore).toHaveBeenCalledWith({ token, confirmation: 'RESTORE' })
    expect(container.textContent).toContain('Restarting to restore')
    expect(guard.mock.calls.at(-1)![0]!('HOME_DASHBOARD')).toBe(false)
    expect(button('Choose where to save').closest('fieldset')!.disabled).toBe(true)
  })
  it('cancels a restore review without touching current records', async () => {
    await mount()
    await prepare()
    await click('Cancel restore')
    expect(api.discardRestore).toHaveBeenCalledWith({ token })
    expect(api.restore).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Cancelled. No application data was changed.')
  })
  it('blocks repeat actions and navigation while waiting for a drive operation', async () => {
    let finish!: (result: BackupActionResult) => void
    vi.mocked(api.inspect).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await mount()
    await input('backup-open-password', password)
    await click('Choose and verify backup')
    expect(guard.mock.calls.at(-1)![0]!('HOME_DASHBOARD')).toBe(false)
    await click('Choose and verify backup')
    expect(api.inspect).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Keep the drive connected')
    await act(async () => finish(createIpcSuccess({ status: 'CANCELLED' })))
    expect(guard.mock.calls.at(-1)![0]!('HOME_DASHBOARD')).toBe(true)
  })
  it.each([
    ['INVALID_BACKUP', 'password is incorrect'],
    ['DESTINATION_EXISTS', 'Choose a new name'],
    ['UNAVAILABLE', 'drive is connected'],
    ['SYNC_RECOVERY_REQUIRED', 'requires sync reconciliation'],
    ['DIFFERENT_INSTALLATION', 'different installation'],
    ['RESTORE_EXPIRED', 'Review the backup again']
  ] as const)('shows a useful %s message', async (status, text) => {
    vi.mocked(api.prepareRestore).mockResolvedValue(createIpcSuccess({ status }))
    await mount()
    await prepare()
    expect(container.querySelector('[role=alert]')?.textContent).toContain(text)
    expect(api.restore).not.toHaveBeenCalled()
  })
  it('handles an expired sign-in and sanitizes unexpected transport failures', async () => {
    vi.mocked(api.inspect)
      .mockResolvedValueOnce(createIpcSuccess({ status: 'AUTHENTICATION_REQUIRED' }))
      .mockRejectedValueOnce(new Error('/private/path secret'))
    await mount()
    await input('backup-open-password', password)
    await click('Choose and verify backup')
    expect(authenticate).toHaveBeenCalledWith('AUTH_UNAUTHENTICATED')
    await input('backup-open-password', password)
    await click('Choose and verify backup')
    expect(container.textContent).not.toContain('/private/path')
  })
  it('discards a late restore preview after the workspace unmounts', async () => {
    let finish!: (result: BackupActionResult) => void
    vi.mocked(api.prepareRestore).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await mount()
    await prepare()
    await act(async () => root.render(null))
    await act(async () => finish(createIpcSuccess({ status: 'RESTORE_READY', metadata, token })))
    expect(api.discardRestore).toHaveBeenCalledWith({ token })
    expect(api.restore).not.toHaveBeenCalled()
  })
  it('does not expose backup controls to nurses', async () => {
    await mount('NURSE')
    expect(container.textContent).toContain('Only a local administrator')
    expect(container.querySelector('input')).toBeNull()
  })
})
