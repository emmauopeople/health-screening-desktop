import type { RefObject } from 'react'

import type { ApplicationWorkspaceRoute } from './application-shell-types'

interface PlannedModuleWorkspaceProps {
  readonly route: Extract<ApplicationWorkspaceRoute, { status: 'PLANNED_MODULE' }>
  readonly headingId: string
  readonly headingRef: RefObject<HTMLHeadingElement | null>
  onBackToDashboard(): void
}

export function PlannedModuleWorkspace({
  route,
  headingId,
  headingRef,
  onBackToDashboard
}: PlannedModuleWorkspaceProps): React.JSX.Element {
  return (
    <section className="planned-module" aria-labelledby={headingId}>
      <p className="application-workspace-kicker">Planned module</p>
      <h1 ref={headingRef} id={headingId} tabIndex={-1}>
        {route.heading}
      </h1>
      <div className="planned-module-notice">
        <strong>{route.statement}</strong>
        <span>Owning future work package: {route.plannedOwner}</span>
      </div>
      <p>
        This workspace is intentionally transparent. It does not contain forms, patient rows,
        clinical actions, generated results, or operational counts in this build.
      </p>
      <button className="button button-primary" type="button" onClick={onBackToDashboard}>
        Back to dashboard
      </button>
    </section>
  )
}
