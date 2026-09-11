import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { LocalUserRole, PatientErrorCode } from '@shared/ipc'
import type {
  PublicManagedUser,
  UserAdministrationApi,
  UserAdministrationMutationRequest,
  UserAdministrationFailureStatus
} from '@shared/ipc/user-administration-contracts'
import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import './users-administration.css'

type Mode = 'VIEW' | 'CREATE' | 'UPDATE' | 'RESET_PASSWORD' | 'UNLOCK'
interface Props {
  readonly api: UserAdministrationApi | undefined
  readonly userRole: LocalUserRole
  readonly timeZone: string
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: PatientErrorCode): void
  registerNavigationGuard(guard: WorkspaceNavigationGuard | null): void
}
export function UsersAdministrationWorkspace({
  api,
  userRole,
  timeZone,
  headingId,
  headingRef,
  onAuthenticationFailure,
  registerNavigationGuard
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
  const [items, setItems] = useState<PublicManagedUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [currentUserId, setCurrentUserId] = useState('')
  const [selected, setSelected] = useState<PublicManagedUser | null>(null)
  const [mode, setMode] = useState<Mode>('VIEW')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  const mounted = useRef(true)
  const saving = useRef(false)
  const hasDraft = useRef(false)
  const formHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      request.current += 1
    }
  }, [])
  useEffect(() => {
    registerNavigationGuard(
      () =>
        !saving.current && (!hasDraft.current || window.confirm('Discard unsaved user changes?'))
    )
    return () => registerNavigationGuard(null)
  }, [registerNavigationGuard])
  useEffect(() => {
    if (mode !== 'VIEW') formHeading.current?.focus()
  }, [mode])
  const handleFailure = useCallback(
    (code: string) => {
      if (code === 'AUTHENTICATION_REQUIRED' || code === 'SESSION_CHANGED')
        onAuthenticationFailure('AUTH_UNAUTHENTICATED')
      if (code === 'FORBIDDEN') onAuthenticationFailure('AUTHORIZATION_FAILED')
      if (code === 'IPC_FORBIDDEN') onAuthenticationFailure('IPC_FORBIDDEN')
      setMessage(
        messages[code as UserAdministrationFailureStatus] ??
          'User administration is unavailable. Please retry.'
      )
    },
    [onAuthenticationFailure]
  )
  const load = useCallback(
    async (nextPage: number) => {
      if (userRole !== 'LOCAL_ADMIN') return
      const token = ++request.current
      setLoading(true)
      try {
        if (api === undefined) {
          handleFailure('UNAVAILABLE')
          return
        }
        const result = await api.search({ query: query.trim(), status, page: nextPage })
        if (!mounted.current || request.current !== token) return
        if (!result.ok || result.data.status !== 'LOADED') {
          setItems([])
          setSelected(null)
          setTotal(0)
          handleFailure(result.ok ? result.data.status : result.error.code)
          return
        }
        const data = result.data
        if (data.items.length === 0 && nextPage > 1) {
          setPage(1)
          return
        }
        setItems(data.items)
        setTotal(data.total)
        setPage(data.page)
        setCurrentUserId(data.currentUserId)
        setSelected(
          (previous) => data.items.find((item) => item.id === previous?.id) ?? data.items[0] ?? null
        )
      } catch {
        if (mounted.current && request.current === token) {
          setItems([])
          setSelected(null)
          setTotal(0)
          handleFailure('UNAVAILABLE')
        }
      } finally {
        if (mounted.current && request.current === token) setLoading(false)
      }
    },
    [api, query, status, userRole, handleFailure]
  )
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        setMessage('')
        void load(page)
      },
      query.trim() ? 250 : 0
    )
    return () => {
      window.clearTimeout(timer)
      request.current += 1
    }
  }, [load, query, page])
  const save = async (data: UserAdministrationMutationRequest): Promise<void> => {
    if (saving.current || api === undefined) return
    saving.current = true
    setBusy(true)
    setMessage('')
    setNotice('')
    try {
      const result = await api.mutate(data)
      if (!mounted.current) return
      if (!result.ok || result.data.status !== 'SAVED') {
        const code = result.ok ? result.data.status : result.error.code
        handleFailure(code)
        if (code === 'VERSION_CONFLICT') {
          hasDraft.current = false
          setMode('VIEW')
          await load(page)
        }
        return
      }
      hasDraft.current = false
      setMode('VIEW')
      setSelected(result.data.user)
      setNotice(
        data.action === 'CREATE'
          ? 'User created. A password change is required at first sign-in.'
          : data.action === 'RESET_PASSWORD'
            ? 'Password reset. A password change is required at next sign-in.'
            : data.action === 'UNLOCK'
              ? 'Account unlocked.'
              : 'User updated.'
      )
      await load(page)
    } catch {
      if (mounted.current) handleFailure('UNAVAILABLE')
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const edit = (next: Mode): void => {
    setMode(next)
    setMessage('')
    setNotice('')
    hasDraft.current = false
  }
  const self = selected?.id === currentUserId
  if (userRole !== 'LOCAL_ADMIN')
    return <p role="alert">Only a local administrator can manage users.</p>
  return (
    <section className="users-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading">
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          Users
        </h1>
      </header>
      <fieldset className="users-toolbar" disabled={busy || mode !== 'VIEW'}>
        <label>
          Search users
          <input
            type="search"
            value={query}
            placeholder="Name or username"
            maxLength={100}
            onChange={(event) => {
              setLoading(true)
              setQuery(event.currentTarget.value)
              setPage(1)
            }}
          />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setLoading(true)
              setStatus(event.currentTarget.value as typeof status)
              setPage(1)
            }}
          >
            <option value="ALL">All users</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setMessage('')
            void load(page)
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={loading || api === undefined}
          onClick={() => edit('CREATE')}
        >
          Add user
        </button>
      </fieldset>
      {message ? <p role="alert">{message}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="users-panels">
        <section className="users-list" aria-label="User accounts">
          <div className="users-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id} aria-selected={selected?.id === user.id}>
                    <td>
                      <button
                        className="users-select"
                        type="button"
                        disabled={mode !== 'VIEW' || busy || loading}
                        onClick={() => {
                          setSelected(user)
                          setMessage('')
                          setNotice('')
                        }}
                      >
                        <strong>{user.displayName}</strong>
                        <span>
                          {user.username}
                          {user.id === currentUserId ? ' (you)' : ''}
                        </span>
                      </button>
                    </td>
                    <td>{roleLabel(user.role)}</td>
                    <td>
                      {user.isActive ? 'Active' : 'Inactive'}
                      {user.mustChangePassword ? <small>Password change required</small> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 ? <p>{loading ? 'Loading users...' : 'No users found.'}</p> : null}
          </div>
          <footer className="users-pagination">
            <span>
              {total} users · Page {page} of {Math.max(1, Math.ceil(total / 25))}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || busy || mode !== 'VIEW' || page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || busy || mode !== 'VIEW' || page * 25 >= total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </footer>
        </section>
        <section className="users-detail" aria-label="User details">
          {mode !== 'VIEW' ? (
            <UserForm
              key={`${mode}:${selected?.id ?? ''}:${selected?.updatedAt ?? ''}`}
              mode={mode}
              user={selected}
              busy={busy}
              headingRef={formHeading}
              onDirty={() => {
                hasDraft.current = true
              }}
              onCancel={() => {
                hasDraft.current = false
                edit('VIEW')
              }}
              onSave={save}
            />
          ) : selected === null ? (
            <p>Select a user or add an account.</p>
          ) : (
            <>
              <h2>{selected.displayName}</h2>
              <p>
                {selected.username}
                {self ? ' · Your account' : ''}
              </p>
              <dl>
                <dt>Role</dt>
                <dd>{roleLabel(selected.role)}</dd>
                <dt>Account</dt>
                <dd>{selected.isActive ? 'Active' : 'Inactive'}</dd>
                <dt>Password change required</dt>
                <dd>{selected.mustChangePassword ? 'Yes' : 'No'}</dd>
                <dt>Failed sign-ins</dt>
                <dd>{selected.failedLoginCount}</dd>
                <dt>Locked until</dt>
                <dd>{formatTime(selected.lockedUntil, timeZone)}</dd>
                <dt>Last sign-in</dt>
                <dd>{formatTime(selected.lastLoginAt, timeZone)}</dd>
                <dt>Created</dt>
                <dd>{formatTime(selected.createdAt, timeZone)}</dd>
              </dl>
              {self ? (
                <p>Ask another local administrator to change your account.</p>
              ) : (
                <div className="users-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={loading || busy}
                    onClick={() => edit('UPDATE')}
                  >
                    Edit user
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={loading || busy}
                    onClick={() => edit('RESET_PASSWORD')}
                  >
                    Reset password
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={
                      loading ||
                      busy ||
                      (selected.failedLoginCount === 0 && selected.lockedUntil === null)
                    }
                    onClick={() => edit('UNLOCK')}
                  >
                    Unlock account
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </section>
  )
}
function UserForm({
  mode,
  user,
  busy,
  headingRef,
  onSave,
  onCancel,
  onDirty
}: {
  readonly mode: Exclude<Mode, 'VIEW'>
  readonly user: PublicManagedUser | null
  readonly busy: boolean
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onSave(data: UserAdministrationMutationRequest): Promise<void>
  onCancel(): void
  onDirty(): void
}): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [name, setName] = useState(mode === 'CREATE' ? '' : (user?.displayName ?? ''))
  const [role, setRole] = useState<LocalUserRole>(
    mode === 'CREATE' ? 'NURSE' : (user?.role ?? 'NURSE')
  )
  const [active, setActive] = useState(user?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const withPassword = mode === 'CREATE' || mode === 'RESET_PASSWORD'
  return (
    <form
      className="users-form"
      onChange={onDirty}
      onSubmit={(event) => {
        event.preventDefault()
        setError('')
        if (withPassword && password !== confirmation) {
          setError('Passwords do not match.')
          return
        }
        const expected = { userId: user?.id ?? '', expectedUpdatedAt: user?.updatedAt ?? '' }
        const data: UserAdministrationMutationRequest =
          mode === 'CREATE'
            ? { action: 'CREATE', username, displayName: name, role, temporaryPassword: password }
            : mode === 'UPDATE'
              ? { action: 'UPDATE', ...expected, displayName: name, role, isActive: active, reason }
              : mode === 'RESET_PASSWORD'
                ? { action: 'RESET_PASSWORD', ...expected, temporaryPassword: password, reason }
                : { action: 'UNLOCK', ...expected, reason }
        setPassword('')
        setConfirmation('')
        void onSave(data)
      }}
    >
      <h2 ref={headingRef} tabIndex={-1}>
        {mode === 'CREATE'
          ? 'Add user'
          : mode === 'UPDATE'
            ? 'Edit user'
            : mode === 'RESET_PASSWORD'
              ? 'Reset password'
              : 'Unlock account'}
      </h2>
      {mode !== 'CREATE' ? (
        <p>
          {user?.displayName} · {user?.username}
        </p>
      ) : null}
      <fieldset disabled={busy}>
        {mode === 'CREATE' ? (
          <label>
            Username
            <input
              required
              minLength={3}
              maxLength={64}
              autoComplete="off"
              value={username}
              onChange={(event) => setUsername(event.currentTarget.value)}
            />
          </label>
        ) : null}
        {mode === 'CREATE' || mode === 'UPDATE' ? (
          <>
            <label>
              Display name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label>
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.currentTarget.value as LocalUserRole)}
              >
                <option value="NURSE">Nurse</option>
                <option value="TRAINED_SCREENER">Trained screener</option>
                <option value="LOCAL_ADMIN">Local administrator</option>
              </select>
            </label>
          </>
        ) : null}
        {mode === 'UPDATE' ? (
          <label>
            Account status
            <select
              value={active ? 'ACTIVE' : 'INACTIVE'}
              onChange={(event) => setActive(event.currentTarget.value === 'ACTIVE')}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
        {withPassword ? (
          <>
            <p>
              Use a temporary password of 12–128 characters. The user must change it at next
              sign-in.
            </p>
            <label>
              Temporary password
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            </label>
            <label>
              Confirm temporary password
              <input
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.currentTarget.value)}
              />
            </label>
          </>
        ) : null}
        {mode !== 'CREATE' ? (
          <label>
            Reason for change
            <textarea
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="users-actions">
          <button className="button button-primary" type="submit">
            {busy
              ? 'Saving...'
              : mode === 'CREATE'
                ? 'Create user'
                : mode === 'UPDATE'
                  ? 'Save changes'
                  : mode === 'RESET_PASSWORD'
                    ? 'Reset password'
                    : 'Unlock account'}
          </button>
          <button className="button button-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  )
}
function roleLabel(role: LocalUserRole): string {
  return role === 'LOCAL_ADMIN'
    ? 'Local administrator'
    : role === 'NURSE'
      ? 'Nurse'
      : 'Trained screener'
}
function formatTime(value: string | null, timeZone: string): string {
  return value === null
    ? 'None'
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone
      }).format(new Date(value))
}
const messages: Record<UserAdministrationFailureStatus, string> = {
  AUTHENTICATION_REQUIRED: 'Sign in again to manage users.',
  FORBIDDEN: 'Administrator access is required.',
  VALIDATION_FAILED:
    'Check the name, username, password and required reason. Usernames need 3–64 letters, numbers, dots, underscores or hyphens and must start and end with a letter or number.',
  UNAVAILABLE: 'User administration is unavailable. Please retry.',
  USERNAME_EXISTS: 'That username is already in use.',
  USER_NOT_FOUND: 'This account no longer exists. Refresh the user list.',
  VERSION_CONFLICT: 'This account changed. Review the refreshed details and try again.',
  SELF_CHANGE_FORBIDDEN: 'Ask another local administrator to change your account.',
  LAST_ADMIN: 'Keep at least one active local administrator.',
  SESSION_CHANGED: 'Your sign-in session changed. Sign in again.'
}
