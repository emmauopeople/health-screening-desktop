// @vitest-environment jsdom
/// <reference lib="dom" />

import { readFileSync } from 'node:fs'

import { act, createElement, type RefObject } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIpcSuccess,
  createPatientFailure,
  type HealthScreeningApi,
  type PatientErrorCode,
  type PublicPatientDetail,
  type PublicPatientDuplicateCandidate,
  type PublicPatientDuplicatePair,
  type PublicPatientSummary
} from '@shared/ipc'
import { PatientRegistryWorkspace } from '../../../src/renderer/src/app/patients/PatientRegistryWorkspace'
import type {
  ApplicationCommandId,
  PatientWorkspaceNavigationGuard
} from '../../../src/renderer/src/app/shell/application-shell-types'

type PatientCommandId = Extract<
  ApplicationCommandId,
  | 'PATIENTS_PATIENT_SEARCH'
  | 'PATIENTS_REGISTER_NEW_PATIENT'
  | 'PATIENTS_RECENT_PATIENTS'
  | 'PATIENTS_POSSIBLE_DUPLICATES'
>
type PatientUpdateResult = Awaited<ReturnType<HealthScreeningApi['patient']['update']>>

type MockedPatientApi = {
  search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  get: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['get']>>
  create: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['create']>>
  update: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['update']>>
  listRecent: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['listRecent']>>
  findDuplicates: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['findDuplicates']>>
  markNotDuplicate: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['markNotDuplicate']>>
}
type MockedHealthScreeningApi = HealthScreeningApi & {
  patient: MockedPatientApi
}

interface MountedWorkspace {
  readonly api: MockedHealthScreeningApi
  readonly container: HTMLElement
  readonly onAuthenticationFailure: ReturnType<typeof vi.fn<(code: PatientErrorCode) => void>>
  readonly onSelectCommand: ReturnType<typeof vi.fn<(commandId: ApplicationCommandId) => void>>
  getSelectedPatient(): PublicPatientDetail | null
  setCommandId(commandId: PatientCommandId): Promise<void>
  runNavigationGuard(commandId: ApplicationCommandId): Promise<boolean>
  unmount(): Promise<void>
}

interface DeferredPromise<TValue> {
  readonly promise: Promise<TValue>
  resolve(value: TValue): void
  reject(error: unknown): void
}

const baseTimestamp = '2026-08-03T12:00:00.000Z'
const patientIdOne = '11111111-1111-4111-8111-111111111111'
const patientIdTwo = '22222222-2222-4222-8222-222222222222'
const patientIdThree = '33333333-3333-4333-8333-333333333333'

describe('patient registry workspace mounted regressions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('loads the default patient page, selects the first patient, and preserves explicit search controls', async () => {
    const api = createApi()
    const firstPage = createPatientSummaryPage(25)
    const firstPatient = firstPage[0]
    const secondPage = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: firstPage, page: 1, pageSize: 25, total: 30 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: firstPatient === undefined ? [] : [firstPatient],
          page: 1,
          pageSize: 25,
          total: 30
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [secondPage], page: 2, pageSize: 25, total: 30 })
      )
    api.patient.get.mockImplementation(({ patientId }) =>
      Promise.resolve(
        createIpcSuccess(
          patientId === patientIdTwo
            ? patientDetail({
                id: patientIdTwo,
                patientCode: 'PT-000002',
                displayName: 'Brice Muna',
                givenName: 'Brice',
                familyName: 'Muna'
              })
            : patientDetail()
        )
      )
    )

    const mounted = await mountWorkspace({ api })

    expect(api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(searchLabel(mounted).textContent).toBe('Patient search')
    expect(text(mounted)).toContain('Patient 25')
    expect(text(mounted)).toContain('Showing 1-25 of 30 patients.')
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('PT-000001')
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })

    await changeInput(searchInput(mounted), 'Ada')

    expect(api.patient.search).toHaveBeenCalledOnce()

    await clickButton(mounted, 'Search')

    expect(api.patient.search).toHaveBeenCalledWith({ query: 'Ada', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('Ada Ngono')
    expect(api.patient.get).toHaveBeenCalledTimes(1)

    await clickButton(mounted, 'Next')

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'Ada', page: 2, pageSize: 25 })
    expect(text(mounted)).toContain('Brice Muna')
    expect(text(mounted)).not.toContain('Ada Ngono')
    expect(api.patient.get).toHaveBeenCalledTimes(2)
    expect(mounted.container.querySelector('[data-shell-slot="patient-tabs"]')).toBeNull()

    await mounted.unmount()
  })

  it('suppresses stale search results and restores search controls after thrown failures', async () => {
    const api = createApi()
    const staleSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockReturnValueOnce(staleSearch.promise)
      .mockReturnValueOnce(currentSearch.promise)
      .mockRejectedValueOnce(new Error('transport down'))

    const mounted = await mountWorkspace({ api })

    await changeInput(searchInput(mounted), 'old')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), 'new')
    await dispatchKeyboard(searchInput(mounted), 'Enter')

    currentSearch.resolve(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Current Match',
            givenName: 'Current',
            familyName: 'Match'
          })
        ],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    staleSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Stale Match' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).toContain('Current Match')
    expect(text(mounted)).not.toContain('Stale Match')

    await clickButton(mounted, 'Search')

    expect(text(mounted)).toContain('The desktop service is unavailable.')
    expect(buttonByText(mounted, 'Search').disabled).toBe(false)

    await mounted.unmount()
  })

  it('clears the detail pane when the default registry load is empty', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )

    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ displayName: 'Prior Protected Patient' })
    })

    expect(api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('No registered patients. Register New is available.')
    expect(text(mounted)).not.toContain('Prior Protected Patient')
    expect(mounted.getSelectedPatient()).toBeNull()

    await mounted.unmount()
  })

  it('clears the prior patient when an explicit search returns no results', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientDetail()))

    const mounted = await mountWorkspace({ api })

    expect(text(mounted)).toContain('PT-000001')

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')

    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'No matches',
      page: 1,
      pageSize: 25
    })
    expect(text(mounted)).toContain('No matching patients.')
    expect(text(mounted)).not.toContain('Ada Ngono')
    expect(mounted.getSelectedPatient()).toBeNull()

    await mounted.unmount()
  })

  it('guards dirty zero-result searches and Cancel preserves the old table, draft, and conflict state', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    const latest = patientDetail({
      displayName: 'Ada Latest',
      village: 'Latest Village',
      rowVersion: 2
    })
    api.patient.update.mockResolvedValueOnce(
      createIpcSuccess({ status: 'PATIENT_VERSION_CONFLICT', patient: latest })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )

    await clickButton(mounted, 'Save changes')

    expect(text(mounted)).toContain('Latest authoritative patient')
    expect(text(mounted)).toContain('Latest Village')

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')

    expect(dialog(mounted)).not.toBeNull()
    expect(buttonByTextWithin(dialog(mounted)!, 'Save changes')).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByTextWithin(dialog(mounted)!, 'Discard edits')).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByTextWithin(dialog(mounted)!, 'Cancel')).toBeInstanceOf(HTMLButtonElement)
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).not.toContain('No matching patients.')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(dialog(mounted)).toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(text(mounted)).toContain('Latest authoritative patient')
    expect(text(mounted)).toContain('Unsaved edits')
    expect(text(mounted)).not.toContain('No matching patients.')

    await mounted.unmount()
  })

  it('discards dirty edits before applying an empty search result', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Discard edits')

    expect(dialog(mounted)).toBeNull()
    expect(text(mounted)).toContain('No matching patients.')
    expect(text(mounted)).not.toContain('Ada Ngono')
    expect(mounted.getSelectedPatient()).toBeNull()
    expect(text(mounted)).toContain('Select a patient to view or update details.')

    await mounted.unmount()
  })

  it('saves dirty edits before applying an empty search result', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    api.patient.update.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'UPDATED',
        patient: patientDetail({ village: 'Dirty Village', rowVersion: 2 })
      })
    )

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Save changes')

    expect(api.patient.update).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      patch: expect.objectContaining({ village: 'Dirty Village' })
    })
    expect(dialog(mounted)).toBeNull()
    expect(text(mounted)).toContain('No matching patients.')
    expect(mounted.getSelectedPatient()).toBeNull()

    await mounted.unmount()
  })

  it('keeps the old table, patient, and draft when guarded save fails before an empty search', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    api.patient.update.mockResolvedValueOnce(createPatientFailure('INTERNAL_ERROR'))

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Save changes')

    expect(dialog(mounted)).not.toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(text(mounted)).not.toContain('No matching patients.')
    expect(text(mounted)).toContain('The application could not complete the request.')

    await mounted.unmount()
  })

  it('guards dirty searches that would select another first patient and Cancel keeps the old result set', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Brice Muna',
            givenName: 'Brice',
            familyName: 'Muna'
          })
        ],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )

    await changeInput(searchInput(mounted), 'Brice')
    await clickButton(mounted, 'Search')

    expect(dialog(mounted)).not.toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).not.toContain('Brice Muna')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(dialog(mounted)).toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).not.toContain('Brice Muna')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')

    await mounted.unmount()
  })

  it('discards dirty edits before selecting a different first search result', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Brice Muna',
            givenName: 'Brice',
            familyName: 'Muna'
          })
        ],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    api.patient.get.mockResolvedValueOnce(
      createIpcSuccess(
        patientDetail({
          id: patientIdTwo,
          patientCode: 'PT-000002',
          displayName: 'Brice Muna',
          givenName: 'Brice',
          familyName: 'Muna'
        })
      )
    )

    await changeInput(searchInput(mounted), 'Brice')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Discard edits')

    expect(dialog(mounted)).toBeNull()
    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Brice Muna')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)

    await mounted.unmount()
  })

  it('applies dirty search results without a guard when the selected patient remains visible', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Brice Muna',
            givenName: 'Brice',
            familyName: 'Muna'
          }),
          patientSummary()
        ],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )

    await changeInput(searchInput(mounted), 'Ada or Brice')
    await clickButton(mounted, 'Search')

    expect(dialog(mounted)).toBeNull()
    expect(text(mounted)).toContain('Brice Muna')
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(api.patient.get).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('suppresses stale dirty search results without replacing a pending guarded transition', async () => {
    const api = createApi()
    const staleSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search
      .mockReturnValueOnce(staleSearch.promise)
      .mockReturnValueOnce(currentSearch.promise)
    api.patient.get.mockResolvedValueOnce(
      createIpcSuccess(
        patientDetail({
          id: patientIdTwo,
          patientCode: 'PT-000002',
          displayName: 'Current Patient',
          givenName: 'Current',
          familyName: 'Patient'
        })
      )
    )

    await changeInput(searchInput(mounted), 'stale')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), 'current')
    await dispatchKeyboard(searchInput(mounted), 'Enter')

    currentSearch.resolve(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Current Patient',
            givenName: 'Current',
            familyName: 'Patient'
          })
        ],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(dialog(mounted)).not.toBeNull()
    expect(text(mounted)).not.toContain('Current Patient')

    staleSearch.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
    await flushReact()

    expect(dialog(mounted)).not.toBeNull()
    expect(text(mounted)).not.toContain('No matching patients.')

    await clickButtonWithin(dialog(mounted)!, 'Discard edits')

    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Current Patient')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)

    await mounted.unmount()
  })

  it('bypasses dirty search guards and clears protected state on IPC_FORBIDDEN', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({
      api,
      initialDetail: patientDetail({
        patientCode: 'PT-000099',
        displayName: 'Protected Name',
        village: 'Original Village'
      }),
      initialSummary: patientSummary({ patientCode: 'PT-000099', displayName: 'Protected Name' })
    })
    api.patient.search.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))

    await clickButton(mounted, 'Search')

    expect(dialog(mounted)).toBeNull()
    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(mounted.getSelectedPatient()).toBeNull()
    expect(text(mounted)).not.toContain('Protected Name')

    await mounted.unmount()
  })

  it('guards dirty pagination before replacing the selected patient', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api, initialSearchTotal: 50 })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [
          patientSummary({
            id: patientIdTwo,
            patientCode: 'PT-000002',
            displayName: 'Page Two Patient',
            givenName: 'Page Two',
            familyName: 'Patient'
          })
        ],
        page: 2,
        pageSize: 25,
        total: 50
      })
    )

    await clickButton(mounted, 'Next')

    expect(dialog(mounted)).not.toBeNull()
    expect(text(mounted)).not.toContain('Page Two Patient')
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(text(mounted)).toContain('Page 1 / 2')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')

    await mounted.unmount()
  })

  it('guards dirty page-size changes and restores the prior page size on Cancel', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api, initialSearchTotal: 75 })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 50, total: 0 })
    )

    await changeSelect(pageSizeSelect(mounted), '50')

    expect(dialog(mounted)).not.toBeNull()
    expect(pageSizeSelect(mounted).value).toBe('25')
    expect(text(mounted)).not.toContain('No matching patients.')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(pageSizeSelect(mounted).value).toBe('25')
    expect(text(mounted)).toContain('Page 1 / 3')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')

    await mounted.unmount()
  })

  it('selects the first row on next and previous pages when the prior selection is absent', async () => {
    const api = createApi()
    const pageOne = patientSummary()
    const pageTwo = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [pageOne], page: 1, pageSize: 25, total: 50 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [pageTwo], page: 2, pageSize: 25, total: 50 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [pageOne], page: 1, pageSize: 25, total: 50 })
      )
    api.patient.get.mockImplementation(({ patientId }) =>
      Promise.resolve(
        createIpcSuccess(
          patientId === patientIdTwo
            ? patientDetail({
                id: patientIdTwo,
                patientCode: 'PT-000002',
                displayName: 'Brice Muna',
                givenName: 'Brice',
                familyName: 'Muna'
              })
            : patientDetail()
        )
      )
    )

    const mounted = await mountWorkspace({ api })

    await clickButton(mounted, 'Next')

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: '', page: 2, pageSize: 25 })
    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Brice Muna')

    await clickButton(mounted, 'Previous')

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Ada Ngono')

    await mounted.unmount()
  })

  it('reloads page one immediately when page size changes', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 50, total: 75 }))

    const mounted = await mountWorkspace({ api })

    await changeSelect(pageSizeSelect(mounted), '50')

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: '', page: 1, pageSize: 50 })
    expect(text(mounted)).toContain('Page 1 / 2')

    await mounted.unmount()
  })

  it('reveals and selects a newly created patient without a manual search', async () => {
    const api = createApi()
    const createdPatient = patientDetail({
      id: patientIdThree,
      patientCode: 'PT-000003',
      displayName: 'Created Patient',
      givenName: 'Created',
      familyName: 'Patient'
    })
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({ status: 'CREATED', patient: createdPatient })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary(createdPatient)],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')

    expect(api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(searchInput(mounted).value).toBe('')
    expect(patientRowByCode(mounted, 'PT-000003').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdThree)
    expect(text(mounted)).toContain('PT-000003')
    expect(text(mounted)).toContain('Created Patient')
    expect(mounted.onSelectCommand).toHaveBeenCalledWith('PATIENTS_PATIENT_SEARCH')

    await mounted.unmount()
  })

  it('suppresses stale patient-detail responses after a newer selection', async () => {
    const api = createApi()
    const staleDetail = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['get']>>>()
    const currentDetail =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['get']>>>()
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [
            patientSummary({
              id: patientIdTwo,
              patientCode: 'PT-000002',
              displayName: 'Current Patient',
              givenName: 'Current',
              familyName: 'Patient'
            })
          ],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    api.patient.get
      .mockReturnValueOnce(staleDetail.promise)
      .mockReturnValueOnce(currentDetail.promise)

    const mounted = await mountWorkspace({ api })

    await changeInput(searchInput(mounted), 'Current')
    await clickButton(mounted, 'Search')

    currentDetail.resolve(
      createIpcSuccess(
        patientDetail({
          id: patientIdTwo,
          patientCode: 'PT-000002',
          displayName: 'Current Patient',
          givenName: 'Current',
          familyName: 'Patient'
        })
      )
    )
    await flushReact()

    staleDetail.resolve(createIpcSuccess(patientDetail({ displayName: 'Stale Patient' })))
    await flushReact()

    expect(text(mounted)).toContain('Current Patient')
    expect(text(mounted)).not.toContain('Stale Patient')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)

    await mounted.unmount()
  })

  it('loads a selected patient and saves edited patient details', async () => {
    const api = createApi()
    const summary = patientSummary()
    const selected = patientDetail()
    const updated = patientDetail({
      displayName: 'Ada Edited',
      givenName: 'Ada Edited',
      rowVersion: 2
    })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [summary], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(selected))
    api.patient.update.mockResolvedValueOnce(
      createIpcSuccess({ status: 'UPDATED', patient: updated })
    )

    const mounted = await mountWorkspace({ api })

    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('PT-000001')

    await clickButton(mounted, 'Edit')
    await changeInput(fieldInput(mounted, 'Given name'), 'Ada Edited')
    await clickButton(mounted, 'Save changes')

    expect(api.patient.update).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      patch: expect.objectContaining({ givenName: 'Ada Edited' })
    })
    expect(text(mounted)).toContain('Changes saved.')
    expect(text(mounted)).toContain('Ada Edited')
    expect(text(mounted)).not.toContain('Unsaved edits')

    await mounted.unmount()
  })

  it('preserves attempted edits when a patient version conflict is returned', async () => {
    const api = createApi()
    const original = patientDetail({ village: 'Original Village' })
    const latest = patientDetail({
      displayName: 'Ada Latest',
      village: 'Latest Village',
      rowVersion: 2,
      updatedByDisplayName: 'Second User'
    })
    api.patient.update.mockResolvedValueOnce(
      createIpcSuccess({ status: 'PATIENT_VERSION_CONFLICT', patient: latest })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary(original)], page: 1, pageSize: 25, total: 1 })
    )

    const mounted = await mountWorkspace({ api, selectedPatient: original })

    await clickButton(mounted, 'Edit')
    await changeInput(fieldInput(mounted, 'Village'), 'Attempted Village')
    await clickButton(mounted, 'Save changes')

    expect(text(mounted)).toContain('The patient changed after you opened it.')
    expect(text(mounted)).toContain('Latest authoritative patient')
    expect(text(mounted)).toContain('Latest Village')
    expect(fieldInput(mounted, 'Village').value).toBe('Attempted Village')
    expect(text(mounted)).toContain('Unsaved edits')

    await clickButton(mounted, 'Continue editing')

    expect(fieldInput(mounted, 'Village').value).toBe('Attempted Village')
    expect(text(mounted)).not.toContain('Latest authoritative patient')

    await mounted.unmount()
  })

  it('guards dirty workspace navigation, traps dialog focus, blocks Escape while saving, and resumes after save', async () => {
    const api = createApi()
    const failedSave = createDeferred<PatientUpdateResult>()
    const savedPatient = patientDetail({ village: 'Saved Village', rowVersion: 2 })
    api.patient.update
      .mockReturnValueOnce(failedSave.promise)
      .mockResolvedValueOnce(createIpcSuccess({ status: 'UPDATED', patient: savedPatient }))
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary({ village: 'Original Village' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )

    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ village: 'Original Village' })
    })

    await clickButton(mounted, 'Edit')
    const villageInput = fieldInput(mounted, 'Village')
    await changeInput(villageInput, 'Dirty Village')
    villageInput.focus()

    expect(await mounted.runNavigationGuard('HOME_DASHBOARD')).toBe(false)
    expect(dialog(mounted)?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialogHeading(mounted))

    await dispatchKeyboard(dialog(mounted)!, 'Escape')

    expect(dialog(mounted)).toBeNull()
    expect(document.activeElement).toBe(villageInput)
    expect(mounted.onSelectCommand).not.toHaveBeenCalled()

    expect(await mounted.runNavigationGuard('HOME_DASHBOARD')).toBe(false)
    await clickButtonWithin(dialog(mounted)!, 'Save changes')
    await dispatchKeyboard(dialog(mounted)!, 'Escape')

    expect(dialog(mounted)).not.toBeNull()

    failedSave.resolve(createPatientFailure('INTERNAL_ERROR'))
    await flushReact()

    expect(dialog(mounted)).not.toBeNull()
    expect(mounted.onSelectCommand).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('The application could not complete the request.')

    await clickButtonWithin(dialog(mounted)!, 'Save changes')

    expect(mounted.onSelectCommand).toHaveBeenCalledWith('HOME_DASHBOARD')
    expect(dialog(mounted)).toBeNull()
    expect(text(mounted)).toContain('Changes saved.')

    await mounted.unmount()
  })

  it('renders registration required indicators and focuses the first invalid enabled control', async () => {
    const api = createApi()
    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    expect(requiredGroupLabel(mounted, 'Patient name').textContent).toContain('*')
    expect(requiredGroupLabel(mounted, 'Patient name').textContent).toContain('required')
    expect(requiredGroupLabel(mounted, 'Date of birth or approximate age').textContent).toContain(
      '*'
    )
    expect(text(mounted)).toContain('At least one name field is required.')
    expect(fieldInput(mounted, 'Given name').getAttribute('aria-required')).toBeNull()
    expect(fieldInput(mounted, 'Family name').getAttribute('aria-required')).toBeNull()
    expect(fieldInput(mounted, 'Other names').getAttribute('aria-required')).toBeNull()
    expect(fieldInput(mounted, 'Age as of date').getAttribute('aria-required')).toBeNull()

    await clickButton(mounted, 'Create patient')

    expect(api.patient.create).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Enter a date of birth or approximate age.')
    expect(document.activeElement).toBe(fieldInput(mounted, 'Given name'))

    await mounted.unmount()
  })

  it('disables approximate age fields when exact date of birth is entered', async () => {
    const mounted = await mountWorkspace({ commandId: 'PATIENTS_REGISTER_NEW_PATIENT' })

    await changeInput(fieldInput(mounted, 'Date of birth'), '1990-01-02')

    expect(fieldInput(mounted, 'Approximate age').value).toBe('')
    expect(fieldInput(mounted, 'Approximate age').disabled).toBe(true)
    expect(fieldInput(mounted, 'Age as of date').value).toBe('')
    expect(fieldInput(mounted, 'Age as of date').disabled).toBe(true)
    expect(text(mounted)).toContain('Disabled because an exact date of birth is recorded.')
    expect(fieldInput(mounted, 'Approximate age').getAttribute('aria-describedby')).toContain(
      'patient-registration-exact-dob-disabled-note'
    )

    await mounted.unmount()
  })

  it('disables date of birth and requires age as of date when approximate age is entered', async () => {
    const mounted = await mountWorkspace({ commandId: 'PATIENTS_REGISTER_NEW_PATIENT' })

    await changeInput(fieldInput(mounted, 'Date of birth'), '1990-01-02')
    await changeInput(fieldInput(mounted, 'Date of birth'), '')
    await changeInput(fieldInput(mounted, 'Approximate age'), '34')

    expect(fieldInput(mounted, 'Date of birth').value).toBe('')
    expect(fieldInput(mounted, 'Date of birth').disabled).toBe(true)
    expect(fieldInput(mounted, 'Age as of date').disabled).toBe(false)
    expect(fieldInput(mounted, 'Age as of date').getAttribute('aria-required')).toBe('true')
    expect(fieldInput(mounted, 'Age as of date').value).toBe(currentLocalDate())
    expect(fieldLabel(mounted, 'Age as of date').textContent).toContain('*')
    expect(fieldLabel(mounted, 'Age as of date').textContent).toContain('required')

    await mounted.unmount()
  })

  it('clearing approximate age restores the date-of-birth option and clears age as of date', async () => {
    const mounted = await mountWorkspace({ commandId: 'PATIENTS_REGISTER_NEW_PATIENT' })

    await changeInput(fieldInput(mounted, 'Approximate age'), '34')
    await changeInput(fieldInput(mounted, 'Age as of date'), '2020-02-03')
    await changeInput(fieldInput(mounted, 'Approximate age'), '')

    expect(fieldInput(mounted, 'Date of birth').disabled).toBe(false)
    expect(fieldInput(mounted, 'Age as of date').value).toBe('')
    expect(fieldInput(mounted, 'Age as of date').disabled).toBe(true)
    expect(fieldInput(mounted, 'Age as of date').getAttribute('aria-required')).toBeNull()

    await mounted.unmount()
  })

  it('does not submit stale age values when switching between age-entry methods', async () => {
    const api = createApi()
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'CREATED',
        patient: patientDetail({ id: patientIdThree, patientCode: 'PT-000003' })
      })
    )
    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await changeInput(fieldInput(mounted, 'Given name'), 'Ada')
    await changeInput(fieldInput(mounted, 'Approximate age'), '34')
    await changeInput(fieldInput(mounted, 'Age as of date'), '2020-02-03')
    await changeInput(fieldInput(mounted, 'Approximate age'), '')
    await changeInput(fieldInput(mounted, 'Date of birth'), '1990-01-02')
    await clickButton(mounted, 'Create patient')

    expect(api.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dateOfBirth: '1990-01-02',
        approximateAgeYears: null,
        ageAsOfDate: null,
        duplicateReviewToken: null
      })
    )

    await mounted.unmount()
  })

  it('creates a valid exact-date-of-birth registration', async () => {
    const api = createApi()
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'CREATED',
        patient: patientDetail({ id: patientIdThree, patientCode: 'PT-000003' })
      })
    )
    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')

    expect(api.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        givenName: 'Ada',
        dateOfBirth: '1990-01-02',
        approximateAgeYears: null,
        ageAsOfDate: null,
        duplicateReviewToken: null
      })
    )
    expect(text(mounted)).toContain('Patient created.')

    await mounted.unmount()
  })

  it('creates a valid approximate-age registration', async () => {
    const api = createApi()
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'CREATED',
        patient: patientDetail({ id: patientIdThree, patientCode: 'PT-000003' })
      })
    )
    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await fillApproximateAgeRegistration(mounted)
    await changeInput(fieldInput(mounted, 'Age as of date'), '2020-02-03')
    await clickButton(mounted, 'Create patient')

    expect(api.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        givenName: 'Ada',
        dateOfBirth: null,
        approximateAgeYears: 34,
        ageAsOfDate: '2020-02-03',
        duplicateReviewToken: null
      })
    )
    expect(text(mounted)).toContain('Patient created.')

    await mounted.unmount()
  })

  it('surfaces registration validation failures without leaving creation busy', async () => {
    const api = createApi()
    api.patient.create.mockResolvedValueOnce(createPatientFailure('VALIDATION_FAILED'))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    expect(registrationWorkspace(mounted).classList.contains('patient-registration-centered')).toBe(
      true
    )
    expect(
      registrationWorkspace(mounted).classList.contains('patient-registration-review-layout')
    ).toBe(false)
    expect(
      registrationFormPanel(mounted).classList.contains('patient-registration-form-panel')
    ).toBe(true)
    expect(duplicateReviewPanel(mounted)).toBeNull()
    expect(mounted.container.querySelector('[data-shell-slot="patient-tabs"]')).toBeNull()

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')

    expect(api.patient.create).toHaveBeenCalledOnce()
    expect(text(mounted)).toContain('The request could not be processed.')
    expect(buttonByText(mounted, 'Create patient').disabled).toBe(false)

    await mounted.unmount()
  })

  it('clears registration draft on authorization failure without an auth-generation remount', async () => {
    const api = createApi()
    api.patient.create.mockResolvedValueOnce(createPatientFailure('AUTHORIZATION_FAILED'))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await changeInput(fieldInput(mounted, 'Given name'), 'Protected Draft')
    await changeInput(fieldInput(mounted, 'Family name'), 'Unauthorized')
    await changeInput(fieldInput(mounted, 'Date of birth'), '1990-01-02')
    await clickButton(mounted, 'Create patient')

    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('AUTHORIZATION_FAILED')
    expect(fieldInput(mounted, 'Given name').value).toBe('')
    expect(fieldInput(mounted, 'Family name').value).toBe('')

    await mounted.unmount()
  })

  it('requires explicit duplicate-review confirmation and prevents double submission', async () => {
    const api = createApi()
    const created = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['create']>>>()
    const candidate = duplicateCandidate(
      patientSummary({ id: patientIdTwo, patientCode: 'PT-000002' })
    )
    api.patient.create
      .mockResolvedValueOnce(
        createIpcSuccess({
          status: 'DUPLICATE_REVIEW_REQUIRED',
          candidates: [candidate],
          duplicateReviewToken: 'duplicate-review-token-1'
        })
      )
      .mockReturnValueOnce(created.promise)

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')

    expect(
      registrationWorkspace(mounted).classList.contains('patient-registration-review-layout')
    ).toBe(true)
    expect(registrationWorkspace(mounted).classList.contains('patient-registration-centered')).toBe(
      false
    )
    expect(duplicateReviewPanel(mounted)?.querySelector('h2')?.textContent).toBe(
      'Possible Duplicate Patients'
    )
    expect(text(mounted)).toContain('Possible Duplicate Patients')
    expect(text(mounted)).toContain('Match reasons: name, date of birth')
    expect(buttonByText(mounted, 'Open existing patient')).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByText(mounted, 'Return to edit')).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByText(mounted, 'Continue registration despite possible matches')).toBeInstanceOf(
      HTMLButtonElement
    )
    expect(buttonByText(mounted, 'Create patient').disabled).toBe(true)
    expect(mounted.container.querySelector('[data-shell-slot="patient-tabs"]')).toBeNull()
    expect(stylesheet()).toMatch(
      /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.patient-registration-review-layout,[\s\S]*grid-template-columns:\s*1fr;/
    )

    await clickButton(mounted, 'Continue registration despite possible matches')

    expect(api.patient.create).toHaveBeenCalledOnce()
    expect(dialog(mounted)).not.toBeNull()

    await clickElementTwice(
      buttonByTextWithin(dialog(mounted)!, 'Continue registration despite possible matches')
    )

    expect(api.patient.create).toHaveBeenCalledTimes(2)
    expect(api.patient.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ duplicateReviewToken: 'duplicate-review-token-1' })
    )

    created.resolve(
      createIpcSuccess({
        status: 'CREATED',
        patient: patientDetail({ id: patientIdThree, patientCode: 'PT-000003' })
      })
    )
    await flushReact()

    expect(text(mounted)).toContain('Patient created.')
    expect(text(mounted)).toContain('PT-000003')
    expect(mounted.onSelectCommand).toHaveBeenCalledWith('PATIENTS_PATIENT_SEARCH')

    await mounted.unmount()
  })

  it('supports duplicate review Return to edit and Open existing patient actions', async () => {
    const api = createApi()
    const existing = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Existing Match',
      givenName: 'Existing',
      familyName: 'Match'
    })
    api.patient.create.mockResolvedValue(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(existing)],
        duplicateReviewToken: 'duplicate-review-token-2'
      })
    )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(existing))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT'
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Return to edit')

    expect(text(mounted)).not.toContain('Possible Duplicate Patients')
    expect(duplicateReviewPanel(mounted)).toBeNull()

    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')

    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdTwo })
    expect(mounted.onSelectCommand).toHaveBeenCalledWith('PATIENTS_PATIENT_SEARCH')
    expect(text(mounted)).toContain('Existing Match')

    await mounted.unmount()
  })

  it('loads recent patients, reviews possible duplicate pairs, and marks a pair not duplicate', async () => {
    const api = createApi()
    const recent = patientSummary({ displayName: 'Recent Patient' })
    api.patient.listRecent.mockResolvedValueOnce(createIpcSuccess([recent]))
    api.patient.get.mockResolvedValueOnce(
      createIpcSuccess(patientDetail({ displayName: 'Recent Patient' }))
    )

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_RECENT_PATIENTS'
    })

    expect(api.patient.listRecent).toHaveBeenCalledWith({ limit: 25 })
    expect(text(mounted)).toContain('Recent Patient')

    await clickButton(mounted, 'Select')

    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })

    const pair = duplicatePair()
    api.patient.findDuplicates
      .mockResolvedValueOnce(createIpcSuccess({ candidates: [], pairs: [pair] }))
      .mockResolvedValueOnce(createIpcSuccess({ candidates: [], pairs: [] }))
    api.patient.markNotDuplicate.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'MARKED_NOT_DUPLICATE',
        pairKey: pair.pairKey,
        reviewedAt: baseTimestamp
      })
    )

    await mounted.setCommandId('PATIENTS_POSSIBLE_DUPLICATES')

    expect(api.patient.findDuplicates).toHaveBeenCalledWith({
      identity: null,
      patientId: null,
      limit: 25
    })
    expect(text(mounted)).toContain('PT-000001')
    expect(text(mounted)).toContain('PT-000002')
    expect(text(mounted)).toContain('Match reasons: name, phone')

    await clickButton(mounted, 'Mark not duplicate')

    expect(api.patient.markNotDuplicate).toHaveBeenCalledWith({
      patientIdA: patientIdOne,
      patientIdB: patientIdTwo,
      reasonCodes: ['MANUAL_REVIEW']
    })
    expect(text(mounted)).toContain('Duplicate review saved.')
    expect(text(mounted)).toContain('No possible duplicates.')

    await mounted.unmount()
  })

  it('fails closed on IPC_FORBIDDEN from every patient operation', async () => {
    const cases: readonly {
      readonly name: string
      readonly commandId: PatientCommandId
      readonly configure: (api: MockedHealthScreeningApi) => void
      readonly run: (mounted: MountedWorkspace) => Promise<void>
    }[] = [
      {
        name: 'search',
        commandId: 'PATIENTS_PATIENT_SEARCH',
        configure: (api) => {
          api.patient.search.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async () => {
          await flushReact()
        }
      },
      {
        name: 'get',
        commandId: 'PATIENTS_PATIENT_SEARCH',
        configure: (api) => {
          api.patient.search.mockResolvedValueOnce(
            createIpcSuccess({
              items: [patientSummary({ id: patientIdTwo, patientCode: 'PT-000002' })],
              page: 1,
              pageSize: 25,
              total: 1
            })
          )
          api.patient.get.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async () => {
          await flushReact()
        }
      },
      {
        name: 'create',
        commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
        configure: (api) => {
          api.patient.create.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async (mounted) => {
          await fillExactDobRegistration(mounted)
          await clickButton(mounted, 'Create patient')
        }
      },
      {
        name: 'update',
        commandId: 'PATIENTS_PATIENT_SEARCH',
        configure: (api) => {
          api.patient.search.mockResolvedValueOnce(
            createIpcSuccess({
              items: [patientSummary({ patientCode: 'PT-000099', displayName: 'Protected Name' })],
              page: 1,
              pageSize: 25,
              total: 1
            })
          )
          api.patient.update.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async (mounted) => {
          await clickButton(mounted, 'Edit')
          await changeInput(fieldInput(mounted, 'Given name'), 'Forbidden Edit')
          await clickButton(mounted, 'Save changes')
        }
      },
      {
        name: 'listRecent',
        commandId: 'PATIENTS_RECENT_PATIENTS',
        configure: (api) => {
          api.patient.listRecent.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async () => {
          await flushReact()
        }
      },
      {
        name: 'findDuplicates',
        commandId: 'PATIENTS_POSSIBLE_DUPLICATES',
        configure: (api) => {
          api.patient.findDuplicates.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async () => {
          await flushReact()
        }
      },
      {
        name: 'markNotDuplicate',
        commandId: 'PATIENTS_POSSIBLE_DUPLICATES',
        configure: (api) => {
          api.patient.findDuplicates.mockResolvedValueOnce(
            createIpcSuccess({ candidates: [], pairs: [duplicatePair()] })
          )
          api.patient.markNotDuplicate.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async (mounted) => {
          await clickButton(mounted, 'Mark not duplicate')
        }
      }
    ]

    for (const testCase of cases) {
      const api = createApi()
      testCase.configure(api)
      const mounted = await mountWorkspace({
        api,
        commandId: testCase.commandId,
        selectedPatient: patientDetail({ patientCode: 'PT-000099', displayName: 'Protected Name' })
      })

      await testCase.run(mounted)

      expect(mounted.onAuthenticationFailure, testCase.name).toHaveBeenCalledWith('IPC_FORBIDDEN')
      expect(text(mounted), testCase.name).not.toContain('Protected Name')

      await mounted.unmount()
    }
  })

  it('reconciles authentication patient failures and suppresses stale loads after protected-state invalidation', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createPatientFailure('AUTH_LOCKED'))
      .mockResolvedValueOnce(createPatientFailure('AUTH_UNAUTHENTICATED'))
      .mockResolvedValueOnce(createPatientFailure('AUTH_PASSWORD_CHANGE_REQUIRED'))
      .mockResolvedValueOnce(createPatientFailure('AUTHORIZATION_FAILED'))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary()],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    const staleGet = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['get']>>>()
    api.patient.get.mockReturnValueOnce(staleGet.promise)

    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ patientCode: 'PT-000099', displayName: 'Protected Name' })
    })

    await clickButton(mounted, 'Search')
    await clickButton(mounted, 'Search')
    await clickButton(mounted, 'Search')

    expect(mounted.onAuthenticationFailure).toHaveBeenNthCalledWith(1, 'AUTH_LOCKED')
    expect(mounted.onAuthenticationFailure).toHaveBeenNthCalledWith(2, 'AUTH_UNAUTHENTICATED')
    expect(mounted.onAuthenticationFailure).toHaveBeenNthCalledWith(
      3,
      'AUTH_PASSWORD_CHANGE_REQUIRED'
    )
    expect(mounted.onAuthenticationFailure).toHaveBeenNthCalledWith(4, 'AUTHORIZATION_FAILED')
    expect(text(mounted)).not.toContain('Protected Name')

    await clickButton(mounted, 'Search')
    api.patient.search.mockResolvedValueOnce(createPatientFailure('AUTH_LOCKED'))
    await clickButton(mounted, 'Search')

    staleGet.resolve(createIpcSuccess(patientDetail({ displayName: 'Stale Patient' })))
    await flushReact()

    expect(mounted.onAuthenticationFailure).toHaveBeenLastCalledWith('AUTH_LOCKED')
    expect(text(mounted)).not.toContain('Stale Patient')

    await mounted.unmount()
  })
})

async function mountWorkspace({
  api = createApi(),
  commandId = 'PATIENTS_PATIENT_SEARCH',
  selectedPatient = null,
  onAuthenticationFailure = vi.fn<(code: PatientErrorCode) => void>(),
  onSelectCommand = vi.fn<(commandId: ApplicationCommandId) => void>()
}: {
  readonly api?: MockedHealthScreeningApi
  readonly commandId?: PatientCommandId
  readonly selectedPatient?: PublicPatientDetail | null
  readonly onAuthenticationFailure?: ReturnType<typeof vi.fn<(code: PatientErrorCode) => void>>
  readonly onSelectCommand?: ReturnType<typeof vi.fn<(commandId: ApplicationCommandId) => void>>
} = {}): Promise<MountedWorkspace> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const headingRef = { current: null } as RefObject<HTMLHeadingElement | null>
  let currentCommandId = commandId
  let currentSelectedPatient = selectedPatient
  let registeredGuard: PatientWorkspaceNavigationGuard | null = null
  let renderQueued = false

  const renderWorkspace = (): void => {
    root.render(
      createElement(PatientRegistryWorkspace, {
        api,
        commandId: currentCommandId,
        headingId: 'patient-registry-test-heading',
        headingRef,
        selectedPatient: currentSelectedPatient,
        onSelectedPatientChange: (nextPatient) => {
          currentSelectedPatient = nextPatient
          scheduleRender()
        },
        onPatientAuthenticationFailure: onAuthenticationFailure,
        onSelectCommand: (nextCommandId) => {
          onSelectCommand(nextCommandId)

          if (isPatientCommand(nextCommandId)) {
            currentCommandId = nextCommandId
            scheduleRender()
          }
        },
        registerNavigationGuard: (guard) => {
          registeredGuard = guard
        }
      })
    )
  }

  const scheduleRender = (): void => {
    if (renderQueued) {
      return
    }

    renderQueued = true
    queueMicrotask(() => {
      renderQueued = false
      renderWorkspace()
    })
  }

  await act(async () => {
    renderWorkspace()
    await flushPromises()
  })
  await flushReact()

  return {
    api,
    container,
    onAuthenticationFailure,
    onSelectCommand,
    getSelectedPatient(): PublicPatientDetail | null {
      return currentSelectedPatient
    },
    async setCommandId(nextCommandId: PatientCommandId): Promise<void> {
      await act(async () => {
        currentCommandId = nextCommandId
        renderWorkspace()
        await flushPromises()
      })
      await flushReact()
    },
    async runNavigationGuard(nextCommandId: ApplicationCommandId): Promise<boolean> {
      let result = true

      await act(async () => {
        result = registeredGuard?.(nextCommandId) ?? true
        await flushPromises()
      })
      await flushReact()

      return result
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount()
        await flushPromises()
      })
      container.remove()
    }
  }
}

async function mountDirtyPatientSearchWorkspace({
  api = createApi(),
  initialDetail = patientDetail({ village: 'Original Village' }),
  initialSummary = patientSummary(initialDetail),
  initialSearchTotal = 1,
  draftVillage = 'Dirty Village'
}: {
  readonly api?: MockedHealthScreeningApi
  readonly initialDetail?: PublicPatientDetail
  readonly initialSummary?: PublicPatientSummary
  readonly initialSearchTotal?: number
  readonly draftVillage?: string
} = {}): Promise<MountedWorkspace> {
  api.patient.search.mockResolvedValueOnce(
    createIpcSuccess({
      items: [initialSummary],
      page: 1,
      pageSize: 25,
      total: initialSearchTotal
    })
  )

  const mounted = await mountWorkspace({ api, selectedPatient: initialDetail })

  expect(patientRowByCode(mounted, initialSummary.patientCode).getAttribute('aria-selected')).toBe(
    'true'
  )

  await clickButton(mounted, 'Edit')
  await changeInput(fieldInput(mounted, 'Village'), draftVillage)

  return mounted
}

function createApi(): MockedHealthScreeningApi {
  return {
    patient: {
      search: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      ),
      get: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      create: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      update: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      listRecent: vi.fn(() => Promise.resolve(createIpcSuccess([]))),
      findDuplicates: vi.fn(() => Promise.resolve(createIpcSuccess({ candidates: [], pairs: [] }))),
      markNotDuplicate: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE')))
    }
  } as unknown as MockedHealthScreeningApi
}

function patientSummary(overrides: Partial<PublicPatientSummary> = {}): PublicPatientSummary {
  return {
    id: patientIdOne,
    patientCode: 'PT-000001',
    displayName: 'Ada Ngono',
    givenName: 'Ada',
    familyName: 'Ngono',
    otherNames: null,
    dateOfBirth: '1990-01-02',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Bastos',
    quarter: 'East',
    phone: '+237 600 000 001',
    status: 'ACTIVE',
    rowVersion: 1,
    updatedAt: baseTimestamp,
    ...overrides
  }
}

function createPatientSummaryPage(count: number): PublicPatientSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1

    return patientSummary({
      id: ordinal === 1 ? patientIdOne : `patient-summary-${String(ordinal).padStart(2, '0')}`,
      patientCode: `PT-${String(ordinal).padStart(6, '0')}`,
      displayName: ordinal === 1 ? 'Ada Ngono' : `Patient ${ordinal}`,
      givenName: ordinal === 1 ? 'Ada' : 'Patient',
      familyName: ordinal === 1 ? 'Ngono' : String(ordinal)
    })
  })
}

function patientDetail(overrides: Partial<PublicPatientDetail> = {}): PublicPatientDetail {
  const acknowledgment = overrides.acknowledgment ?? {
    status: 'NOT_REQUESTED',
    recordedAt: null,
    recordedByDisplayName: null
  }

  return {
    ...patientSummary(overrides),
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    acknowledgment,
    createdAt: baseTimestamp,
    createdByDisplayName: 'Admin User',
    updatedByDisplayName: 'Admin User',
    clinicalStatus: 'NOT_AVAILABLE',
    ...overrides
  }
}

function duplicateCandidate(patient: PublicPatientSummary): PublicPatientDuplicateCandidate {
  return {
    patient,
    matchedOn: ['name', 'date_of_birth'],
    score: 87,
    status: 'POSSIBLE_DUPLICATE'
  }
}

function duplicatePair(): PublicPatientDuplicatePair {
  return {
    pairKey: `${patientIdOne}:${patientIdTwo}`,
    first: patientSummary(),
    second: patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Ada Muna',
      familyName: 'Muna'
    }),
    matchedOn: ['name', 'phone'],
    score: 92,
    status: 'POSSIBLE_DUPLICATE'
  }
}

function searchInput(mounted: MountedWorkspace): HTMLInputElement {
  const input = mounted.container.querySelector<HTMLInputElement>('#patient-registry-search')

  if (input === null) {
    throw new Error('Expected patient search input to be rendered.')
  }

  return input
}

function searchLabel(mounted: MountedWorkspace): HTMLLabelElement {
  const label = mounted.container.querySelector<HTMLLabelElement>(
    'label[for="patient-registry-search"]'
  )

  if (label === null) {
    throw new Error('Expected patient search label to be rendered.')
  }

  return label
}

function pageSizeSelect(mounted: MountedWorkspace): HTMLSelectElement {
  const select = mounted.container.querySelector<HTMLSelectElement>(
    'select[aria-label="Page size"]'
  )

  if (select === null) {
    throw new Error('Expected patient search page-size select to be rendered.')
  }

  return select
}

function registrationWorkspace(mounted: MountedWorkspace): HTMLElement {
  const workspace = mounted.container.querySelector<HTMLElement>('.patient-registration')

  if (workspace === null) {
    throw new Error('Expected patient registration workspace to be rendered.')
  }

  return workspace
}

function registrationFormPanel(mounted: MountedWorkspace): HTMLElement {
  const panel = mounted.container.querySelector<HTMLElement>('.patient-registration-form-panel')

  if (panel === null) {
    throw new Error('Expected patient registration form panel to be rendered.')
  }

  return panel
}

function duplicateReviewPanel(mounted: MountedWorkspace): HTMLElement | null {
  return mounted.container.querySelector<HTMLElement>('.patient-duplicate-review')
}

function patientRowByCode(mounted: MountedWorkspace, patientCode: string): HTMLTableRowElement {
  const row = Array.from(mounted.container.querySelectorAll<HTMLTableRowElement>('tbody tr')).find(
    (candidate) => candidate.textContent?.includes(patientCode)
  )

  if (row === undefined) {
    throw new Error(`Expected patient row ${patientCode} to be rendered.`)
  }

  return row
}

function fieldInput(mounted: MountedWorkspace, label: string): HTMLInputElement {
  const field = fieldControl<HTMLInputElement>(mounted, label, 'input')

  if (field === null) {
    throw new Error(`Expected input field ${label} to be rendered.`)
  }

  return field
}

function fieldLabel(mounted: MountedWorkspace, label: string): HTMLLabelElement {
  for (const candidate of Array.from(
    mounted.container.querySelectorAll<HTMLLabelElement>('label')
  )) {
    const text = candidate.querySelector('.patient-field-label-text')?.textContent?.trim()

    if (text === label) {
      return candidate
    }
  }

  throw new Error(`Expected label ${label} to be rendered.`)
}

function requiredGroupLabel(mounted: MountedWorkspace, label: string): HTMLElement {
  const groupLabel = Array.from(
    mounted.container.querySelectorAll<HTMLElement>('.patient-field-group-label')
  ).find((candidate) => candidate.textContent?.includes(label))

  if (groupLabel === undefined) {
    throw new Error(`Expected required group ${label} to be rendered.`)
  }

  return groupLabel
}

function fieldControl<TElement extends HTMLElement>(
  mounted: MountedWorkspace,
  label: string,
  selector: string
): TElement | null {
  for (const candidate of Array.from(
    mounted.container.querySelectorAll<HTMLLabelElement>('label')
  )) {
    const text = candidate.querySelector('span')?.textContent?.trim()

    if (text === label) {
      return candidate.querySelector<TElement>(selector)
    }
  }

  return null
}

async function fillExactDobRegistration(mounted: MountedWorkspace): Promise<void> {
  await changeInput(fieldInput(mounted, 'Given name'), 'Ada')
  await changeInput(fieldInput(mounted, 'Date of birth'), '1990-01-02')
}

async function fillApproximateAgeRegistration(mounted: MountedWorkspace): Promise<void> {
  await changeInput(fieldInput(mounted, 'Given name'), 'Ada')
  await changeInput(fieldInput(mounted, 'Approximate age'), '34')
}

async function clickButton(mounted: MountedWorkspace, label: string): Promise<void> {
  await clickElement(buttonByText(mounted, label))
}

async function clickButtonWithin(container: HTMLElement, label: string): Promise<void> {
  await clickElement(buttonByTextWithin(container, label))
}

function buttonByText(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  return buttonByTextWithin(mounted.container, label)
}

function buttonByTextWithin(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => normalizedText(candidate) === label
  )

  if (button === undefined) {
    throw new Error(`Expected button ${label} to be rendered.`)
  }

  return button
}

async function clickElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function clickElementTwice(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeInput(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function changeSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    valueSetter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

async function dispatchKeyboard(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
  await flushReact()
}

function dialog(mounted: MountedWorkspace): HTMLElement | null {
  return mounted.container.querySelector<HTMLElement>('[role="dialog"]')
}

function dialogHeading(mounted: MountedWorkspace): HTMLHeadingElement {
  const heading = dialog(mounted)?.querySelector<HTMLHeadingElement>('h2')

  if (heading === null || heading === undefined) {
    throw new Error('Expected dialog heading to be rendered.')
  }

  return heading
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/gu, ' ').trim()
}

function text(mounted: MountedWorkspace): string {
  return mounted.container.textContent ?? ''
}

function stylesheet(): string {
  return readFileSync('src/renderer/src/styles/main.css', 'utf8')
}

function currentLocalDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function createDeferred<TValue>(): DeferredPromise<TValue> {
  let resolve: (value: TValue) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function isPatientCommand(commandId: ApplicationCommandId): commandId is PatientCommandId {
  return commandId.startsWith('PATIENTS_')
}

async function flushReact(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await flushPromises()
    })
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
