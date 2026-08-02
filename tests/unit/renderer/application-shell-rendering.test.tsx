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

    expect(markup).toContain('Welcome, Admin User')
    expect(markup).toContain('Local data ready')
    expect(markup).toContain('No active location selected')
    expect(markup).toContain('No screening session open')
    expect(markup).toContain('Patient code')
    expect(markup).toContain('Age / sex')
    expect(markup).toContain('Patient worklist data is not available in HSD-024.')
    expect(markup).not.toContain('Jane')
    expect(markup).not.toContain('sync count')
    expect(markup).not.toContain('backup time')
    expect(dashboardSummaryCards.map((card) => card.label)).toEqual([
      'Screened today',
      'Draft encounters',
      'Open referrals',
      'Pending sync',
      'Last backup'
    ])
    expect(dashboardSummaryCards.every((card) => card.value === '\u2014')).toBe(true)
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
      /\.application-shell\s*\{[\s\S]*grid-template-areas:[\s\S]*'top-bar'[\s\S]*'operation-alert'[\s\S]*'contextual-panel'[\s\S]*'patient-tabs'[\s\S]*'workspace'[\s\S]*max-height: 100vh;[\s\S]*overflow: hidden;/
    )
    expect(css).toMatch(
      /\.application-patient-tabs-anchor\s*\{[\s\S]*grid-area: patient-tabs;[\s\S]*height: 0;[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/
    )
    expect(css).toMatch(
      /\.application-workspace\s*\{[\s\S]*grid-area: workspace;[\s\S]*min-height: 0;[\s\S]*overflow: auto;/
    )
  })
})

function user(role: ApplicationShellUser['role']): ApplicationShellUser {
  return {
    username: 'Admin.User',
    displayName: 'Admin User',
    role
  }
}
