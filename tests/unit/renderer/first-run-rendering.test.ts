import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createSetupCompleteViewModel,
  firstRunScreenCopy
} from '../../../src/renderer/src/app/first-run/first-run-controller'
import {
  firstRunFormCopy,
  firstRunFormFieldsets,
  firstRunLocationTypeOptions
} from '../../../src/renderer/src/app/first-run/first-run-form'
import type { RendererStartupState } from '../../../src/renderer/src/app/first-run/first-run-types'

describe('first-run renderer view model and source boundaries', () => {
  it('exposes the required setup headings, fieldsets, labels, and actions', () => {
    expect(firstRunFormCopy).toMatchObject({
      heading: 'Set up this screening installation.',
      statement:
        'This one-time setup creates the local installation, first administrator, and initial screening location on this computer.',
      offlineStatement: 'Internet access is not required for this setup.',
      submitLabel: 'Initialize application',
      exitLabel: 'Exit application'
    })
    expect(firstRunScreenCopy).toMatchObject({
      loadingStatus: 'Loading local application status.',
      setupCompleteHeading: 'Local setup is complete.',
      inconsistentHeading: 'Local setup cannot continue.',
      unavailableHeading: 'The local desktop service is unavailable.'
    })
    expect(firstRunFormFieldsets.map((fieldset) => fieldset.legend)).toEqual([
      'Installation',
      'Administrator',
      'Initial screening location'
    ])
    expect(
      firstRunFormFieldsets.flatMap((fieldset) => fieldset.fields.map((field) => field.label))
    ).toEqual([
      'Deployment name',
      'Time zone',
      'Administrator username',
      'Administrator display name',
      'Temporary password',
      'Confirm temporary password',
      'Location name',
      'Location type',
      'Village',
      'Subdivision',
      'Region',
      'Directions'
    ])
    expect(firstRunLocationTypeOptions).toEqual([
      { value: 'CHURCH', label: 'Church' },
      { value: 'QUARTER', label: 'Quarter' },
      { value: 'VILLAGE', label: 'Village' },
      { value: 'COMMUNITY_SITE', label: 'Community site' },
      { value: 'OTHER', label: 'Other' }
    ])
  })

  it('keeps setup-complete view data minimized and credential-free', () => {
    const state: Extract<RendererStartupState, { status: 'SETUP_COMPLETE' }> = {
      status: 'SETUP_COMPLETE',
      info: {
        applicationName: 'Health Screening Offline Desktop',
        applicationVersion: '1.0.0',
        platform: 'win32',
        architecture: 'x64',
        packaged: false
      },
      health: {
        status: 'ready',
        ipc: 'available',
        database: 'ready',
        clinicalFeatures: 'not-implemented'
      },
      deploymentName: 'Canonical Deployment',
      timeZone: 'Africa/Douala'
    }

    const viewModel = createSetupCompleteViewModel(state)

    expect(viewModel).toEqual({
      heading: 'Local setup is complete.',
      statement: 'Sign-in and password change are not implemented in this task.',
      deploymentName: 'Canonical Deployment',
      timeZone: 'Africa/Douala'
    })

    const serializedViewModel = JSON.stringify(viewModel)
    expect(serializedViewModel).not.toContain('username')
    expect(serializedViewModel).not.toContain('location')
    expect(serializedViewModel).not.toContain('temporary')
    expect(serializedViewModel).not.toContain('audit')
    expect(serializedViewModel).not.toContain('createdAt')
    expect(serializedViewModel).not.toContain('id')
  })

  it('keeps first-run renderer files inside the preload and browser-persistence boundary', () => {
    const firstRunFiles = [
      'src/renderer/src/app/first-run/FirstRunSetupScreen.tsx',
      'src/renderer/src/app/first-run/FirstRunStateScreen.tsx',
      'src/renderer/src/app/first-run/first-run-controller.ts',
      'src/renderer/src/app/first-run/first-run-form.ts',
      'src/renderer/src/app/first-run/first-run-types.ts'
    ]
    const bannedFragments = [
      '@main',
      '@preload',
      'electron',
      'better-sqlite3',
      'node:',
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'XMLHttpRequest',
      'WebSocket',
      'console.log',
      'console.warn',
      'console.error'
    ]
    const bannedTokenPatterns = [/\bprocess\b/, /\bBuffer\b/, /\brequire\s*\(/, /\bfetch\s*\(/]

    for (const relativePath of firstRunFiles) {
      const source = readFileSync(join(__dirname, '../../../', relativePath), 'utf8')

      for (const fragment of bannedFragments) {
        expect(source, `${relativePath} contains ${fragment}`).not.toContain(fragment)
      }

      for (const pattern of bannedTokenPatterns) {
        expect(source, `${relativePath} matches ${pattern.toString()}`).not.toMatch(pattern)
      }
    }
  })

  it('does not add first-run IPC channels or preload capabilities', () => {
    const channelsSource = readFileSync(
      join(__dirname, '../../../src/shared/ipc/channels.ts'),
      'utf8'
    )
    const preloadSource = readFileSync(join(__dirname, '../../../src/preload/api.ts'), 'utf8')

    expect(channelsSource.match(/health-screening:first-run:/g)).toHaveLength(2)
    expect(preloadSource.match(/firstRun:/g)).toHaveLength(1)
    expect(preloadSource.match(/getState:/g)).toHaveLength(1)
    expect(preloadSource.match(/initialize:/g)).toHaveLength(1)
  })
})
