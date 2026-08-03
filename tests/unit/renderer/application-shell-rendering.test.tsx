import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  ApplicationShell,
  dashboardSummaryCards,
  getVisibleDashboardQuickActions,
  type ApplicationShellContext,
  type ApplicationShellUser
} from '../../../src/renderer/src/app/shell'

const shellContext: ApplicationShellContext = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  deploymentName: 'Local Deployment',
  timeZone: 'Africa/Douala'
}

describe('application shell rendering', () => {
  it('renders the dashboard hierarchy without operational sample data', () => {
    const markup = renderToStaticMarkup(
      createElement(ApplicationShell, {
        context: shellContext,
        user: user('LOCAL_ADMIN'),
        busy: false,
        operationError: null,
        alertRef: { current: null },
        onLock: vi.fn(),
        onLogout: vi.fn()
      })
    )

    const displayMarkup = markup.replaceAll('&#x27;', "'")

    expect(displayMarkup).toContain('Welcome, Admin User')
    expect(displayMarkup).toContain('Local data ready')
    expect(displayMarkup).toContain('No screening session open')
    expect(displayMarkup).toContain('application-command-panel')
    expect(displayMarkup).toContain('Dashboard')
    expect(displayMarkup).toContain("Today's Patient Worklist")
    expect(displayMarkup).not.toContain('Today' + '\\u2019s patient worklist')
    expect(displayMarkup).not.toContain(`Today${String.fromCharCode(0x2019)}s patient worklist`)
    expect(displayMarkup).toContain('Patient code')
    expect(displayMarkup).toContain('Age / sex')
    expect(displayMarkup).toContain('Patient worklist data is not available in HSD-024.')
    expect(displayMarkup).toContain(
      'Patient search, registration, and worklist data are unavailable in HSD-024.'
    )
    expect(displayMarkup).not.toContain('Jane')
    expect(displayMarkup).not.toContain('Grace')
    expect(displayMarkup).not.toContain('BAB-')
    expect(displayMarkup).not.toContain('sync count')
    expect(displayMarkup).not.toContain('backup time')
    expect(displayMarkup).not.toContain('Yesterday')
    expect(dashboardSummaryCards.map((card) => card.label)).toEqual([
      'Screened today',
      'Draft encounters',
      'Open referrals',
      'Pending sync',
      'Last backup'
    ])
    expect(dashboardSummaryCards.every((card) => card.value === '\u2014')).toBe(true)
    expect(displayMarkup.match(/class="dashboard-summary-card"/g)).toHaveLength(5)
    expect(displayMarkup).toContain('class="dashboard-lower-grid"')
    expect(displayMarkup).toContain('class="dashboard-quick-action-number"')
    expect(displayMarkup).toContain('disabled=""')
    expect(displayMarkup).not.toContain(
      'Screening totals require the future encounter data source.</p>'
    )
  })

  it('filters dashboard quick actions by role', () => {
    expect(getVisibleDashboardQuickActions('LOCAL_ADMIN').map((action) => action.label)).toEqual([
      'Find or open patient',
      'Start new screening',
      'Record referral follow-up',
      'Print session summary'
    ])
    expect(
      getVisibleDashboardQuickActions('TRAINED_SCREENER').map((action) => action.label)
    ).toEqual(['Find or open patient', 'Start new screening'])
  })

  it('defines viewport-constrained shell grid slots with a collapsed patient-tab row', () => {
    const css = readFileSync(join(__dirname, '../../../src/renderer/src/styles/main.css'), 'utf8')

    expect(css).toMatch(/\.application-root\s*\{[\s\S]*height: 100vh;[\s\S]*overflow: hidden;/)
    expect(css).toMatch(
      /\.application-shell\s*\{[\s\S]*grid-template-areas:[\s\S]*'top-bar'[\s\S]*'operation-alert'[\s\S]*'contextual-panel'[\s\S]*'patient-tabs'[\s\S]*'workspace'[\s\S]*'footer'[\s\S]*max-height: 100vh;[\s\S]*overflow: hidden;/
    )
    expect(css).toMatch(
      /\.application-patient-tabs-anchor\s*\{[\s\S]*grid-area: patient-tabs;[\s\S]*height: 0;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/
    )
    expect(css).toMatch(
      /\.application-workspace\s*\{[\s\S]*grid-area: workspace;[\s\S]*min-height: 0;[\s\S]*overflow: auto;/
    )
  })

  it('applies the approved application-shell visual tokens and reference layout classes', () => {
    const css = readFileSync(join(__dirname, '../../../src/renderer/src/styles/main.css'), 'utf8')

    for (const token of [
      '--shell-navy: #17375e;',
      '--shell-primary: #1f4e78;',
      '--shell-teal: #0f6b78;',
      '--shell-background: #f6f8fb;',
      '--shell-context-background: #eaf2f8;',
      '--shell-border: #c8d3df;',
      '--shell-text: #1f2937;',
      '--shell-secondary-text: #667085;',
      '--shell-success: #18794e;',
      '--shell-warning: #9a6700;',
      '--shell-referral: #b54708;',
      '--shell-sync: #6941c6;'
    ]) {
      expect(css).toContain(token)
    }

    expect(css).toContain("font-family: 'Segoe UI', 'DejaVu Sans', sans-serif;")
    expect(css).toMatch(
      /\.application-top-bar\s*\{[\s\S]*height: 70px;[\s\S]*background: var\(--shell-navy\);/
    )
    expect(css).toMatch(
      /\.application-command-panel\s*\{[\s\S]*height: 64px;[\s\S]*background: var\(--shell-context-background\);/
    )
    expect(css).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));')
    expect(css).toContain('grid-template-columns: minmax(360px, 475px) minmax(0, 1fr);')
    expect(css).toContain('grid-template-columns: 26px minmax(0, 1fr);')
  })
})

function user(role: ApplicationShellUser['role']): ApplicationShellUser {
  return {
    username: 'Admin.User',
    displayName: 'Admin User',
    role
  }
}
