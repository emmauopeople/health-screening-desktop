import type { RefObject } from 'react'

import { formatPatientTabLabel } from './patient-display'
import type { PatientWorkspaceTab } from './patient-tab-controller'

interface PatientTabsBarProps {
  readonly tabs: readonly PatientWorkspaceTab[]
  readonly activePatientId: string | null
  readonly tabsRef: RefObject<HTMLElement | null>
  onActivate(patientId: string): void
  onClose(patientId: string): void
}

export function PatientTabsBar({
  tabs,
  activePatientId,
  tabsRef,
  onActivate,
  onClose
}: PatientTabsBarProps): React.JSX.Element | null {
  if (tabs.length === 0) {
    return null
  }

  return (
    <nav
      ref={tabsRef}
      className="patient-tabs-bar"
      aria-label="Open patients"
      data-shell-focus-zone="PATIENT_TABS"
    >
      <div role="tablist" className="patient-tabs-list" aria-label="Open patient records">
        {tabs.map((tab, index) => {
          const selected = tab.patientId === activePatientId
          const panelId = `patient-tabpanel-${tab.patientId}`

          return (
            <div key={tab.patientId} className="patient-tab-shell">
              <button
                id={`patient-tab-${tab.patientId}`}
                className="patient-tab-button"
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => onActivate(tab.patientId)}
              >
                <span className="patient-tab-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="patient-tab-label">{formatPatientTabLabel(tab.summary)}</span>
                {tab.dirty ? <span className="patient-tab-dirty">Unsaved</span> : null}
              </button>
              <button
                className="patient-tab-close"
                type="button"
                aria-label={`Close ${formatPatientTabLabel(tab.summary)}`}
                onClick={() => onClose(tab.patientId)}
              >
                x
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
