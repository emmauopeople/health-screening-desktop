import { describe, expect, it } from 'vitest'

import type { PublicPatientSummary, UtcTimestamp } from '@shared/ipc'
import {
  activatePatientTab,
  closePatientTab,
  emptyPatientTabState,
  getActivePatientTab,
  isPatientTabDirty,
  openPatientTab,
  replacePatientTab,
  type PatientTabState
} from '../../../src/renderer/src/app/patients'

describe('patient tab controller', () => {
  it('opens up to four patients and activates an already-open patient instead of duplicating it', () => {
    let state = emptyPatientTabState

    for (let index = 1; index <= 4; index += 1) {
      const result = openPatientTab(state, createPatient(index))

      expect(result.status).toBe('OPENED')
      state = result.state
    }

    expect(state.tabs.map((tab) => tab.patientId)).toEqual([
      patientId(1),
      patientId(2),
      patientId(3),
      patientId(4)
    ])
    expect(state.activePatientId).toBe(patientId(4))

    const duplicate = openPatientTab(state, {
      ...createPatient(2),
      displayName: 'Updated Patient 2',
      revision: '2026-08-03T12:00:00.000Z' as UtcTimestamp
    })

    expect(duplicate.status).toBe('ACTIVATED')
    expect(duplicate.state.tabs).toHaveLength(4)
    expect(duplicate.state.activePatientId).toBe(patientId(2))
    expect(getActivePatientTab(duplicate.state)?.summary.displayName).toBe('Updated Patient 2')

    const capacity = openPatientTab(duplicate.state, createPatient(5))

    expect(capacity.status).toBe('CAPACITY_REACHED')
    expect(capacity.state).toBe(duplicate.state)
  })

  it('replaces a selected tab and closes active tabs predictably', () => {
    let state = openPatientTab(emptyPatientTabState, createPatient(1)).state
    state = openPatientTab(state, createPatient(2)).state
    state = openPatientTab(state, createPatient(3)).state
    state = openPatientTab(state, createPatient(4)).state

    state = replacePatientTab(state, patientId(2), createPatient(5))

    expect(state.tabs.map((tab) => tab.patientId)).toEqual([
      patientId(1),
      patientId(5),
      patientId(3),
      patientId(4)
    ])
    expect(state.activePatientId).toBe(patientId(5))

    state = closePatientTab(state, patientId(5))

    expect(state.tabs.map((tab) => tab.patientId)).toEqual([
      patientId(1),
      patientId(3),
      patientId(4)
    ])
    expect(state.activePatientId).toBe(patientId(4))

    expect(activatePatientTab(state, 'missing')).toBe(state)
  })

  it('reports dirty state per patient tab', () => {
    const cleanState = openPatientTab(emptyPatientTabState, createPatient(1)).state
    const dirtyState: PatientTabState = {
      ...cleanState,
      tabs: cleanState.tabs.map((tab) =>
        tab.patientId === patientId(1)
          ? {
              ...tab,
              dirty: true
            }
          : tab
      )
    }

    expect(isPatientTabDirty(cleanState, patientId(1))).toBe(false)
    expect(isPatientTabDirty(dirtyState, patientId(1))).toBe(true)
    expect(isPatientTabDirty(dirtyState, patientId(2))).toBe(false)
  })
})

function createPatient(index: number): PublicPatientSummary {
  return {
    patientId: patientId(index),
    patientCode: `PT-${String(index).padStart(6, '0')}`,
    displayName: `Patient ${index}`,
    status: 'ACTIVE',
    sex: 'UNKNOWN',
    dateOfBirth: '1990-01-01',
    approximateAgeYears: null,
    approximateAgeAsOfDate: null,
    ageDobDisplay: 'DOB 1990-01-01',
    village: 'Village',
    quarter: null,
    phoneAvailable: false,
    lastScreening: null,
    referralFollowUp: null,
    revision: '2026-08-03T00:00:00.000Z' as UtcTimestamp
  }
}

function patientId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}
