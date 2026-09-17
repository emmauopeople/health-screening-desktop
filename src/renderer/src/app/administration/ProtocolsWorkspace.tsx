import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { LocalUserRole, PatientErrorCode } from '@shared/ipc'
import type { ProtocolApi, ProtocolData } from '@shared/ipc/protocol-contracts'
import { SCREENING_BP_PROTOCOL_V1 } from '@shared/screening-bp-protocol'
import './protocols.css'

interface Props {
  api: ProtocolApi | undefined
  userRole: LocalUserRole
  headingId: string
  headingRef: RefObject<HTMLHeadingElement | null>
  onAuthenticationFailure(code: PatientErrorCode): void
}
export function ProtocolsWorkspace({
  api,
  userRole,
  headingId,
  headingRef,
  onAuthenticationFailure
}: Props): React.JSX.Element {
  const [data, setData] = useState<ProtocolData | null>(null)
  const [loading, setLoading] = useState(true)
  const generation = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    setLoading(true)
    setData(null)
    if (!api || userRole !== 'LOCAL_ADMIN') {
      setData({ status: userRole !== 'LOCAL_ADMIN' ? 'FORBIDDEN' : 'UNAVAILABLE' })
      setLoading(false)
      return
    }
    try {
      const result = await api.get()
      if (current !== generation.current) return
      const next: ProtocolData = result.ok ? result.data : { status: 'UNAVAILABLE' }
      setData(next)
      if (next.status === 'AUTHENTICATION_REQUIRED') onAuthenticationFailure('AUTH_UNAUTHENTICATED')
      if (next.status === 'FORBIDDEN') onAuthenticationFailure('AUTHORIZATION_FAILED')
    } catch {
      if (current === generation.current) setData({ status: 'UNAVAILABLE' })
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }, [api, userRole, onAuthenticationFailure])
  useEffect(() => {
    const current = ++generation.current
    queueMicrotask(() => {
      if (current === generation.current) void load()
    })
    return () => {
      generation.current += 1
    }
  }, [load])
  if (userRole !== 'LOCAL_ADMIN')
    return <p role="alert">Only a local administrator can view protocols.</p>
  const active = data?.status === 'LOADED' ? data.active : null
  const showReference = active !== null || data?.status === 'NO_ACTIVE_PROTOCOL'
  const c = SCREENING_BP_PROTOCOL_V1.configuration
  return (
    <section className="protocols-workspace" aria-labelledby={headingId}>
      <header className="application-workspace-heading protocols-heading">
        <div>
          <h1 id={headingId} ref={headingRef} tabIndex={-1}>
            Protocols
          </h1>
          <p>Read-only screening reference</p>
        </div>
        <button className="button button-secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </header>
      <div className="protocols-scroll" aria-busy={loading}>
        {loading && <p role="status">Loading active protocol…</p>}
        {!loading && data?.status === 'UNAVAILABLE' && (
          <p role="alert">
            The active protocol could not be loaded or validated. Refresh to try again. If this
            continues, the installation needs review.
          </p>
        )}
        {!loading &&
          (data?.status === 'AUTHENTICATION_REQUIRED' || data?.status === 'FORBIDDEN') && (
            <p role="alert">Sign in with an active administrator account to view protocols.</p>
          )}
        {active && (
          <section className="protocols-card" aria-labelledby="active-protocol-title">
            <h2 id="active-protocol-title">Active protocol</h2>
            <dl className="protocols-metadata">
              <div>
                <dt>Protocol</dt>
                <dd>
                  {active.key === 'health-screening-baseline'
                    ? 'Health screening baseline'
                    : active.key}
                </dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{active.version}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>Active</dd>
              </div>
              <div>
                <dt>Effective from</dt>
                <dd>
                  {active.effectiveAt === '1970-01-01T00:00:00.000Z'
                    ? 'Bundled baseline — no dated start'
                    : new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeZone: 'UTC'
                      }).format(new Date(active.effectiveAt)) + ' (UTC)'}
                </dd>
              </div>
            </dl>
            {active.rulesMatch ? (
              <p className="protocols-match">
                The saved blood-pressure protocol matches the rules used by this application.
              </p>
            ) : (
              <p className="protocols-warning" role="alert">
                The saved blood-pressure protocol differs from the rules used by this application.
                The installation needs review. The reference below describes the rules the
                application currently uses.
              </p>
            )}
          </section>
        )}
        {data?.status === 'NO_ACTIVE_PROTOCOL' && (
          <p className="protocols-warning" role="alert">
            No active protocol is recorded. New screening sessions require an active protocol. The
            reference below describes the rules included in this application.
          </p>
        )}
        {showReference && (
          <>
            <section className="protocols-card" aria-labelledby="bp-reference-title">
              <div className="protocols-heading">
                <h2 id="bp-reference-title">Blood-pressure screening rules</h2>
                <span>Rules version {SCREENING_BP_PROTOCOL_V1.version}</span>
              </div>
              <p className="protocols-disclaimer">
                <strong>Screening guidance is not a diagnosis.</strong>
              </p>
              <h3>Rest and repeat measurements</h3>
              <ol>
                <li>Allow {c.initialRestMinutes} minutes of initial rest before measuring.</li>
                <li>
                  If the first systolic reading is {c.repeatSystolicThreshold} mmHg or higher{' '}
                  <strong>or</strong> the first diastolic reading is {c.repeatDiastolicThreshold}{' '}
                  mmHg or higher, a second reading is required before completing Vitals.
                </li>
                <li>
                  Ask the patient to sit quietly with back supported, feet flat, and arm supported
                  at heart level. Wait at least {c.repeatIntervalMinutes} minute before adding the
                  repeat reading.
                </li>
              </ol>
              <p>
                Rest intervals are guidance; the application does not enforce elapsed rest time.
              </p>
              <h3>How readings are summarized</h3>
              <p>
                With one reading, the application uses that reading. With two or more, it uses the
                mean of the last two readings in sequence order. Systolic, diastolic and pulse means
                are each rounded to the nearest whole number. Earlier readings remain in the record.
              </p>
              <h3>Referral decisions</h3>
              <p>
                Rules are checked in the order below. Either blood-pressure value can meet a
                threshold; both values do not have to be high.
              </p>
              <div className="protocols-table-scroll">
                <table>
                  <caption>Blood-pressure decision rules (mmHg)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Outcome</th>
                      <th scope="col">When it applies</th>
                      <th scope="col">Screening guidance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Repeat required</th>
                      <td>
                        Only one reading, with systolic ≥ {c.repeatSystolicThreshold} or diastolic ≥{' '}
                        {c.repeatDiastolicThreshold}, including an initial reading at the urgent
                        threshold.
                      </td>
                      <td>Rest and record a second reading before continuing.</td>
                    </tr>
                    <tr>
                      <th scope="row">Urgent referral</th>
                      <td>
                        At least two readings. The latest reading <strong>or</strong> the rounded
                        mean of the last two has systolic ≥ {c.urgentSystolicThreshold} or diastolic
                        ≥ {c.urgentDiastolicThreshold}.
                      </td>
                      <td>Professional medical review as soon as possible.</td>
                    </tr>
                    <tr>
                      <th scope="row">Standard referral</th>
                      <td>
                        At least two readings. The rounded mean has systolic ≥{' '}
                        {c.repeatSystolicThreshold} or diastolic ≥ {c.repeatDiastolicThreshold},
                        without meeting the urgent rule.
                      </td>
                      <td>Professional medical review.</td>
                    </tr>
                    <tr>
                      <th scope="row">Routine</th>
                      <td>
                        A single reading below both repeat thresholds; or, after repeat readings, a
                        mean below both referral thresholds and a latest reading below both urgent
                        thresholds.
                      </td>
                      <td>No blood-pressure referral threshold was identified by these rules.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
            <p>
              Protocol editing, importing and activation are not available here. Viewing this
              reference does not change screening decisions or historical records.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
