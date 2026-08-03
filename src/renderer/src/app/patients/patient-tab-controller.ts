import type { PublicPatientSummary } from '@shared/ipc'

export interface PatientWorkspaceTab {
  readonly patientId: string
  readonly summary: PublicPatientSummary
  readonly dirty: boolean
  readonly scrollTop: number
}

export interface PatientTabState {
  readonly tabs: readonly PatientWorkspaceTab[]
  readonly activePatientId: string | null
}

export type PatientOpenResult =
  | {
      readonly status: 'OPENED' | 'ACTIVATED'
      readonly state: PatientTabState
    }
  | {
      readonly status: 'CAPACITY_REACHED'
      readonly state: PatientTabState
    }

export const maximumOpenPatientTabs = 4

export const emptyPatientTabState: PatientTabState = Object.freeze({
  tabs: Object.freeze([]),
  activePatientId: null
})

export function openPatientTab(
  state: PatientTabState,
  summary: PublicPatientSummary
): PatientOpenResult {
  const existing = state.tabs.find((tab) => tab.patientId === summary.patientId)

  if (existing !== undefined) {
    return {
      status: 'ACTIVATED',
      state: replaceStateTabs(refreshTabSummary(state.tabs, summary), summary.patientId)
    }
  }

  if (state.tabs.length >= maximumOpenPatientTabs) {
    return {
      status: 'CAPACITY_REACHED',
      state
    }
  }

  const nextTab: PatientWorkspaceTab = Object.freeze({
    patientId: summary.patientId,
    summary,
    dirty: false,
    scrollTop: 0
  })

  return {
    status: 'OPENED',
    state: replaceStateTabs([...state.tabs, nextTab], summary.patientId)
  }
}

export function activatePatientTab(state: PatientTabState, patientId: string): PatientTabState {
  if (!state.tabs.some((tab) => tab.patientId === patientId)) {
    return state
  }

  return replaceStateTabs(state.tabs, patientId)
}

export function refreshPatientTabSummary(
  state: PatientTabState,
  summary: PublicPatientSummary
): PatientTabState {
  if (!state.tabs.some((tab) => tab.patientId === summary.patientId)) {
    return state
  }

  return replaceStateTabs(refreshTabSummary(state.tabs, summary), state.activePatientId)
}

export function closePatientTab(state: PatientTabState, patientId: string): PatientTabState {
  const nextTabs = state.tabs.filter((tab) => tab.patientId !== patientId)
  const activePatientId =
    state.activePatientId === patientId
      ? (nextTabs.at(-1)?.patientId ?? null)
      : state.activePatientId

  return replaceStateTabs(nextTabs, activePatientId)
}

export function replacePatientTab(
  state: PatientTabState,
  replacedPatientId: string,
  summary: PublicPatientSummary
): PatientTabState {
  if (state.tabs.some((tab) => tab.patientId === summary.patientId)) {
    return activatePatientTab(closePatientTab(state, replacedPatientId), summary.patientId)
  }

  const nextTab: PatientWorkspaceTab = Object.freeze({
    patientId: summary.patientId,
    summary,
    dirty: false,
    scrollTop: 0
  })
  const nextTabs = state.tabs.map((tab) => (tab.patientId === replacedPatientId ? nextTab : tab))

  return replaceStateTabs(nextTabs, summary.patientId)
}

export function getActivePatientTab(state: PatientTabState): PatientWorkspaceTab | null {
  return state.tabs.find((tab) => tab.patientId === state.activePatientId) ?? null
}

export function isPatientTabDirty(state: PatientTabState, patientId: string): boolean {
  return state.tabs.find((tab) => tab.patientId === patientId)?.dirty ?? false
}

function refreshTabSummary(
  tabs: readonly PatientWorkspaceTab[],
  summary: PublicPatientSummary
): readonly PatientWorkspaceTab[] {
  return tabs.map((tab) =>
    tab.patientId === summary.patientId
      ? Object.freeze({
          ...tab,
          summary
        })
      : tab
  )
}

function replaceStateTabs(
  tabs: readonly PatientWorkspaceTab[],
  activePatientId: string | null
): PatientTabState {
  return Object.freeze({
    tabs: Object.freeze([...tabs]),
    activePatientId
  })
}
