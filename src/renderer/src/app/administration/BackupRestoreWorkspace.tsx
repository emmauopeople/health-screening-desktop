import { useEffect, useRef, useState, type RefObject } from 'react'
import type { LocalUserRole, PatientErrorCode } from '@shared/ipc'
import type {
  BackupApi,
  BackupActionData,
  BackupActionResult,
  BackupMetadata
} from '@shared/ipc/backup-contracts'
import type { WorkspaceNavigationGuard } from '../shell/application-shell-types'
import './backup-restore.css'

interface Props {
  api: BackupApi | undefined
  userRole: LocalUserRole
  headingId: string
  headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: PatientErrorCode): void
  registerNavigationGuard(guard: WorkspaceNavigationGuard | null): void
}
export function BackupRestoreWorkspace({
  api,
  userRole,
  headingId,
  headingRef,
  onAuthenticationFailure,
  registerNavigationGuard
}: Props): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [openPassword, setOpenPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [metadata, setMetadata] = useState<BackupMetadata | null>(null)
  const [ready, setReady] = useState<Extract<BackupActionData, { status: 'RESTORE_READY' }> | null>(
    null
  )
  const [confirmed, setConfirmed] = useState(false)
  const mounted = useRef(false)
  const pending = useRef(false)
  const token = useRef<string | null>(null)
  const previewHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (token.current) void api?.discardRestore({ token: token.current }).catch(() => {})
    }
  }, [api])
  useEffect(() => {
    registerNavigationGuard(() => !pending.current)
    return () => registerNavigationGuard(null)
  }, [registerNavigationGuard])
  useEffect(() => {
    if (ready) previewHeading.current?.focus()
  }, [ready])

  const perform = async (action: () => Promise<BackupActionResult>): Promise<void> => {
    if (pending.current || !api) return
    pending.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setReady(null)
    setMetadata(null)
    setConfirmed(false)
    setPassword('')
    setConfirmation('')
    setOpenPassword('')
    let acceptedRestart = false
    try {
      const result = await action()
      if (!mounted.current) {
        if (result.ok && result.data.status === 'RESTORE_READY')
          void api.discardRestore({ token: result.data.token }).catch(() => {})
        return
      }
      const status = result.ok ? result.data.status : result.error.code
      if (status === 'AUTHENTICATION_REQUIRED') onAuthenticationFailure('AUTH_UNAUTHENTICATED')
      if (status === 'FORBIDDEN') onAuthenticationFailure('AUTHORIZATION_FAILED')
      if (result.ok && 'metadata' in result.data) setMetadata(result.data.metadata)
      token.current = null
      if (result.ok && result.data.status === 'RESTORE_READY') {
        token.current = result.data.token
        setReady(result.data)
      } else if (status === 'RESTARTING') {
        acceptedRestart = true
        setRestarting(true)
        setMessage('Restarting to restore the backup. Wait for CHS to reopen.')
      } else if (status === 'SAVED') {
        setMessage('Encrypted backup saved. You can now safely eject the drive using Windows.')
      } else if (status === 'VERIFIED') {
        setMessage('Backup verified. The password and database checks passed.')
      } else if (status === 'CANCELLED') {
        setMessage('Cancelled. No application data was changed.')
      } else setError(messages[status] ?? messages.UNAVAILABLE!)
    } catch {
      if (mounted.current) setError(messages.UNAVAILABLE!)
    } finally {
      if (mounted.current) setBusy(false)
      pending.current = acceptedRestart
    }
  }
  if (userRole !== 'LOCAL_ADMIN')
    return <p role="alert">Only a local administrator can manage backups.</p>
  return (
    <section className="backup-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading">
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>
          Backup / Restore
        </h1>
      </header>
      {!api && <p role="alert">Backup services are unavailable. Restart CHS and try again.</p>}
      {error && (
        <p className="backup-error" role="alert">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy ? 'Working… Keep the drive connected until this finishes.' : message}
      </p>
      <div className="backup-panels">
        <section className="backup-card" aria-labelledby="backup-create-title">
          <h2 id="backup-create-title">Create backup</h2>
          <p>Save an encrypted copy of this installation’s records, accounts and configuration.</p>
          <p>
            Choose a folder on this computer, a USB drive or an external hard drive in the Save
            dialog. Keep the drive connected until saving finishes.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (password !== confirmation) {
                setError('The backup passwords do not match.')
                return
              }
              const request = { password }
              void perform(() => api!.create(request))
            }}
          >
            <fieldset disabled={busy || restarting || !api || ready !== null}>
              <label htmlFor="backup-password">Backup password</label>
              <input
                id="backup-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                aria-describedby="backup-password-help"
              />
              <label htmlFor="backup-confirmation">Confirm backup password</label>
              <input
                id="backup-confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.currentTarget.value)}
              />
              <p id="backup-password-help">
                Use 12–128 characters. Keep this password somewhere safe; a lost backup password
                cannot be recovered.
              </p>
              <button className="button button-primary" type="submit">
                Choose where to save
              </button>
            </fieldset>
          </form>
        </section>
        <section className="backup-card" aria-labelledby="backup-open-title">
          <h2 id="backup-open-title">Verify or restore backup</h2>
          <p>Open a .chsbackup file from this computer, a USB drive or an external hard drive.</p>
          <p>
            Restore is available for this same installation before synchronization has been
            configured or used. Restoring replaces current records with the backup’s records.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const request = { password: openPassword }
              void perform(() => api!.inspect(request))
            }}
          >
            <fieldset disabled={busy || restarting || !api || ready !== null}>
              <label htmlFor="backup-open-password">Existing backup password</label>
              <input
                id="backup-open-password"
                type="password"
                autoComplete="off"
                minLength={12}
                maxLength={128}
                required
                value={openPassword}
                onChange={(e) => setOpenPassword(e.currentTarget.value)}
              />
              <div className="backup-actions">
                <button className="button button-secondary" type="submit">
                  Choose and verify backup
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={openPassword.length < 12}
                  onClick={() => {
                    const request = { password: openPassword }
                    void perform(() => api!.prepareRestore(request))
                  }}
                >
                  Review backup for restore
                </button>
              </div>
            </fieldset>
          </form>
          {metadata && (
            <div className="backup-summary">
              <h3 ref={previewHeading} tabIndex={-1}>
                {ready ? 'Review before restoring' : 'Backup summary'}
              </h3>
              <dl>
                <div>
                  <dt>Location</dt>
                  <dd>{metadata.deploymentName}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: metadata.timeZone
                    }).format(new Date(metadata.createdAt))}{' '}
                    ({metadata.timeZone})
                  </dd>
                </div>
                <div>
                  <dt>Patients</dt>
                  <dd>{metadata.counts.patients}</dd>
                </div>
                <div>
                  <dt>Encounters</dt>
                  <dd>{metadata.counts.encounters}</dd>
                </div>
                <div>
                  <dt>Referrals</dt>
                  <dd>{metadata.counts.referrals}</dd>
                </div>
                <div>
                  <dt>User accounts</dt>
                  <dd>{metadata.counts.users}</dd>
                </div>
              </dl>
              {ready && (
                <>
                  <p>
                    CHS will restart. Changes made after this backup will no longer be in the active
                    records. The current data will be kept as a recovery copy on this computer.
                  </p>
                  <p>
                    You must sign in with an account and password that existed in the backup. This
                    review expires after 10 minutes.
                  </p>
                  <label className="backup-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.currentTarget.checked)}
                    />
                    I understand that this replaces the current records and restarts CHS.
                  </label>
                  <div className="backup-actions">
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => {
                        const request = { token: ready.token }
                        void perform(() => api!.discardRestore(request))
                      }}
                    >
                      Cancel restore
                    </button>
                    <button
                      className="button button-primary"
                      disabled={busy || !confirmed}
                      onClick={() => {
                        const request = { token: ready.token, confirmation: 'RESTORE' as const }
                        void perform(() => api!.restore(request))
                      }}
                    >
                      Restore and restart
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
const messages: Record<string, string> = {
  UNAVAILABLE:
    'The operation could not finish. Check that the drive is connected, writable and has enough free space, then try again. No backup success has been recorded.',
  INVALID_BACKUP:
    'The password is incorrect, or the backup is damaged or incomplete. Select the correct file and try again.',
  UNSUPPORTED_BACKUP: 'This backup is not compatible with this version of CHS.',
  DESTINATION_EXISTS:
    'A file already exists with that name. Choose a new name; existing backups are never overwritten.',
  DIFFERENT_INSTALLATION:
    'This backup belongs to a different installation. It can be verified, but cannot be restored here.',
  SYNC_RECOVERY_REQUIRED:
    'This installation or backup has synchronization configuration or history. Restore requires sync reconciliation and is not available in this workflow. You can still create and verify backups.',
  RESTORE_EXPIRED: 'The restore review expired or is no longer valid. Review the backup again.',
  BUSY: 'Another backup operation is in progress. Wait for it to finish.',
  VALIDATION_FAILED: 'Enter a backup password of 12–128 characters.',
  AUTHENTICATION_REQUIRED: 'Sign in again to manage backups.',
  FORBIDDEN: 'An active administrator account is required.'
}
