// @vitest-environment jsdom
/// <reference lib="dom" />
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIpcSuccess,
  type UserAdministrationApi,
  type PatientErrorCode,
  type PublicManagedUser
} from '@shared/ipc'
import { UsersAdministrationWorkspace } from '../../../src/renderer/src/app/administration/UsersAdministrationWorkspace'
import type { WorkspaceNavigationGuard } from '../../../src/renderer/src/app/shell/application-shell-types'
const now = '2026-09-08T12:00:00.000Z'
const admin: PublicManagedUser = {
  id: '69000000-0000-4000-8000-000000000002',
  username: 'admin',
  displayName: 'Admin User',
  role: 'LOCAL_ADMIN',
  isActive: true,
  mustChangePassword: false,
  failedLoginCount: 0,
  lockedUntil: null,
  lastLoginAt: now,
  createdAt: now,
  updatedAt: now
}
const nurse: PublicManagedUser = {
  ...admin,
  id: '69000000-0000-4000-8000-000000000003',
  username: 'nurse',
  displayName: 'Nurse User',
  role: 'NURSE',
  failedLoginCount: 5,
  lockedUntil: '2099-01-01T00:00:00.000Z'
}
let root: Root
let container: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function harness(): {
  api: UserAdministrationApi
  search: ReturnType<typeof vi.fn<UserAdministrationApi['search']>>
  mutate: ReturnType<typeof vi.fn<UserAdministrationApi['mutate']>>
  onAuthenticationFailure: ReturnType<typeof vi.fn<(code: PatientErrorCode) => void>>
  registerNavigationGuard: ReturnType<
    typeof vi.fn<(guard: WorkspaceNavigationGuard | null) => void>
  >
} {
  const search = vi.fn<UserAdministrationApi['search']>(async (request) =>
    createIpcSuccess({
      status: 'LOADED',
      items: [admin, nurse],
      total: 30,
      page: request.page,
      currentUserId: admin.id
    })
  )
  const mutate = vi.fn<UserAdministrationApi['mutate']>(async () =>
    createIpcSuccess({ status: 'SAVED', user: nurse })
  )
  return {
    api: { search, mutate },
    search,
    mutate,
    onAuthenticationFailure: vi.fn<(code: PatientErrorCode) => void>(),
    registerNavigationGuard: vi.fn<(guard: WorkspaceNavigationGuard | null) => void>()
  }
}
async function mount(
  h: ReturnType<typeof harness>,
  role: 'LOCAL_ADMIN' | 'NURSE' = 'LOCAL_ADMIN'
): Promise<void> {
  await act(async () =>
    root.render(
      createElement(UsersAdministrationWorkspace, {
        api: h.api,
        userRole: role,
        timeZone: 'Africa/Douala',
        headingId: 'users-heading',
        headingRef: { current: null },
        onAuthenticationFailure: h.onAuthenticationFailure,
        registerNavigationGuard: h.registerNavigationGuard
      })
    )
  )
  await flush()
}
async function flush(): Promise<void> {
  await act(async () => {
    await vi.runOnlyPendingTimersAsync()
  })
}
async function click(text: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text
  )
  if (!button) throw Error(`Missing button: ${text}`)
  await act(async () => button.click())
  await flush()
}
async function change(label: string, value: string): Promise<void> {
  const control = Array.from(container.querySelectorAll('label'))
    .find((l) => l.firstChild?.textContent === label)
    ?.querySelector('input,select,textarea')
  if (!control) throw Error(`Missing input: ${label}`)
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    )
  })
  await flush()
}
async function selectNurse(): Promise<void> {
  const button = Array.from(container.querySelectorAll('.users-select')).find((b) =>
    b.textContent?.includes('Nurse User')
  ) as HTMLButtonElement
  await act(async () => button.click())
}
describe('UsersAdministrationWorkspace', () => {
  it('loads user details, preserves the current administrator, filters and paginates', async () => {
    const h = harness()
    await mount(h)
    expect(h.search).toHaveBeenCalledWith({ query: '', status: 'ALL', page: 1 })
    expect(container.textContent).toContain('Your account')
    expect(container.textContent).toContain('Ask another local administrator')
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Edit user')
    ).toBe(false)
    await selectNurse()
    expect(container.querySelector('.users-detail')?.textContent).toContain('Failed sign-ins5')
    await change('Search users', 'nur')
    expect(h.search).toHaveBeenLastCalledWith({ query: 'nur', status: 'ALL', page: 1 })
    await change('Status', 'INACTIVE')
    expect(h.search).toHaveBeenLastCalledWith({ query: 'nur', status: 'INACTIVE', page: 1 })
    await click('Next')
    expect(h.search).toHaveBeenLastCalledWith({ query: 'nur', status: 'INACTIVE', page: 2 })
  })
  it('creates an account with matching temporary passwords and clears the form after saving', async () => {
    const h = harness()
    await mount(h)
    await click('Add user')
    await change('Username', 'new.nurse')
    await change('Display name', 'New Nurse')
    await change('Temporary password', 'temporary-pass-123')
    await change('Confirm temporary password', 'different-pass-123')
    await click('Create user')
    expect(h.mutate).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Passwords do not match')
    await change('Confirm temporary password', 'temporary-pass-123')
    await click('Create user')
    expect(h.mutate).toHaveBeenCalledWith({
      action: 'CREATE',
      username: 'new.nurse',
      displayName: 'New Nurse',
      role: 'NURSE',
      temporaryPassword: 'temporary-pass-123'
    })
    expect(container.textContent).toContain('User created.')
    expect(container.querySelector('input[type="password"]')).toBeNull()
  })
  it('saves exact selected-account edits with a reason and guards unsaved changes', async () => {
    const h = harness()
    await mount(h)
    await selectNurse()
    await click('Edit user')
    await change('Role', 'TRAINED_SCREENER')
    await change('Account status', 'INACTIVE')
    await change('Reason for change', 'Staff moved')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const guard = h.registerNavigationGuard.mock.calls.at(-1)![0]!
    expect(await guard('HOME_DASHBOARD')).toBe(false)
    expect(confirm).toHaveBeenCalled()
    await click('Save changes')
    expect(h.mutate).toHaveBeenCalledWith({
      action: 'UPDATE',
      userId: nurse.id,
      expectedUpdatedAt: now,
      displayName: nurse.displayName,
      role: 'TRAINED_SCREENER',
      isActive: false,
      reason: 'Staff moved'
    })
    expect(await guard('HOME_DASHBOARD')).toBe(true)
  })
  it('supports password reset and unlock using the selected account version', async () => {
    const h = harness()
    await mount(h)
    await selectNurse()
    await click('Reset password')
    await change('Temporary password', 'replacement-pass-123')
    await change('Confirm temporary password', 'replacement-pass-123')
    await change('Reason for change', 'Identity verified')
    await click('Reset password')
    expect(h.mutate).toHaveBeenLastCalledWith({
      action: 'RESET_PASSWORD',
      userId: nurse.id,
      expectedUpdatedAt: now,
      temporaryPassword: 'replacement-pass-123',
      reason: 'Identity verified'
    })
    expect(container.textContent).toContain('A password change is required at next sign-in')
    await click('Unlock account')
    await change('Reason for change', 'Identity checked')
    await click('Unlock account')
    expect(h.mutate).toHaveBeenLastCalledWith({
      action: 'UNLOCK',
      userId: nurse.id,
      expectedUpdatedAt: now,
      reason: 'Identity checked'
    })
  })
  it('refreshes stale edits and never reports rejected changes as saved', async () => {
    const h = harness()
    h.mutate.mockResolvedValue(createIpcSuccess({ status: 'VERSION_CONFLICT' }))
    await mount(h)
    await selectNurse()
    await click('Edit user')
    await change('Reason for change', 'Staff moved')
    await click('Save changes')
    expect(container.textContent).toContain('This account changed. Review the refreshed details')
    expect(container.textContent).not.toContain('User updated.')
    expect(h.search).toHaveBeenCalledTimes(2)
  })
  it('blocks non-admin access and routes controlled authorization failures', async () => {
    const h = harness()
    await mount(h, 'NURSE')
    expect(h.search).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Only a local administrator')
    h.search.mockResolvedValue(createIpcSuccess({ status: 'FORBIDDEN' }))
    await mount(h)
    expect(h.onAuthenticationFailure).toHaveBeenCalledWith('AUTHORIZATION_FAILED')
  })
})
