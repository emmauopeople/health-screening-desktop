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
  type LocalUserRole,
  type PatientErrorCode,
  type PublicPatientAcknowledgmentHistoryRecord,
  type PublicPatientDetail,
  type PublicPatientDemographicAmendmentRecord,
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
type PatientAmendDemographicsResult = Awaited<
  ReturnType<HealthScreeningApi['patient']['amendDemographics']>
>

type MockedPatientApi = {
  search: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['search']>>
  get: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['get']>>
  create: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['create']>>
  update: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['update']>>
  amendDemographics: ReturnType<typeof vi.fn<HealthScreeningApi['patient']['amendDemographics']>>
  listDemographicAmendmentHistory: ReturnType<
    typeof vi.fn<HealthScreeningApi['patient']['listDemographicAmendmentHistory']>
  >
  recordAcknowledgment: ReturnType<
    typeof vi.fn<HealthScreeningApi['patient']['recordAcknowledgment']>
  >
  listAcknowledgmentHistory: ReturnType<
    typeof vi.fn<HealthScreeningApi['patient']['listAcknowledgmentHistory']>
  >
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
const actorId = '44444444-4444-4444-8444-444444444444'
const amendmentId = '55555555-5555-4555-8555-555555555555'
const acknowledgmentId = '66666666-6666-4666-8666-666666666666'

describe('patient registry workspace mounted regressions', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('debounces live patient searches until the final 300 millisecond delay', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Say Patient' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()
    const input = searchInput(mounted)
    input.focus()

    await changeInput(input, 'say')

    expect(api.patient.search).toHaveBeenCalledOnce()

    await advanceTimersByTime(299)

    expect(api.patient.search).toHaveBeenCalledOnce()

    await advanceTimersByTime(1)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'say', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('Say Patient')
    expect(document.activeElement).toBe(input)

    await mounted.unmount()
  })

  it('coalesces rapid live-search typing into one final request', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Babungo Patient' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'b')
    await advanceTimersByTime(100)
    await changeInput(searchInput(mounted), 'ba')
    await advanceTimersByTime(100)
    await changeInput(searchInput(mounted), 'bab')
    await advanceTimersByTime(100)
    await changeInput(searchInput(mounted), 'babungo')
    await advanceTimersByTime(299)

    expect(api.patient.search).toHaveBeenCalledOnce()

    await advanceTimersByTime(1)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'babungo',
      page: 1,
      pageSize: 25
    })
    expect(text(mounted)).toContain('Babungo Patient')

    await mounted.unmount()
  })

  it('runs live searches on page one with the current page size', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 50, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Page Size Match' })],
          page: 1,
          pageSize: 50,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })

    await changeSelect(pageSizeSelect(mounted), '50')

    vi.useFakeTimers()
    await changeInput(searchInput(mounted), 'say')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'say', page: 1, pageSize: 50 })
    expect(text(mounted)).toContain('Page Size Match')

    await mounted.unmount()
  })

  it('clears pending live search immediately and restores the default list with first-row selection', async () => {
    const api = createApi()
    const briceSummary = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [briceSummary], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
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
    vi.useFakeTimers()

    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')

    await changeInput(searchInput(mounted), 'Brice')
    await changeInput(searchInput(mounted), '')

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })

  it('clearing live search preserves the current selection when it remains visible', async () => {
    const api = createApi()
    const briceSummary = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [briceSummary, patientSummary()],
          page: 1,
          pageSize: 25,
          total: 2
        })
      )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientDetail()))

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'Ada')
    await changeInput(searchInput(mounted), '')

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.get).toHaveBeenCalledOnce()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)

    await mounted.unmount()
  })

  it('Search and Enter cancel pending live-search debounce timers', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Button Match' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Enter Match' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'button')
    await clickButton(mounted, 'Search')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'button',
      page: 1,
      pageSize: 25
    })

    await changeInput(searchInput(mounted), 'enter')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(3)
    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'enter',
      page: 1,
      pageSize: 25
    })

    await mounted.unmount()
  })

  it('page-size changes cancel pending debounce and immediately use the current input query', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Sized Search' })],
          page: 1,
          pageSize: 50,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'say')
    await changeSelect(pageSizeSelect(mounted), '50')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'say', page: 1, pageSize: 50 })
    expect(text(mounted)).toContain('Sized Search')

    await mounted.unmount()
  })

  it('pagination uses the applied query while a different live-search input is pending', async () => {
    const api = createApi()
    const pageTwo = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Ada Page Two',
      givenName: 'Ada',
      familyName: 'Page Two'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 50 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 50 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [pageTwo], page: 2, pageSize: 25, total: 50 })
      )
    api.patient.get.mockImplementation(({ patientId }) =>
      Promise.resolve(
        createIpcSuccess(
          patientId === patientIdTwo
            ? patientDetail({
                id: patientIdTwo,
                patientCode: 'PT-000002',
                displayName: 'Ada Page Two',
                givenName: 'Ada',
                familyName: 'Page Two'
              })
            : patientDetail()
        )
      )
    )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'Ada')
    await clickButton(mounted, 'Search')
    await changeInput(searchInput(mounted), 'Brice')
    await clickButton(mounted, 'Next')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(3)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'Ada', page: 2, pageSize: 25 })
    expect(text(mounted)).toContain('Ada Page Two')

    await mounted.unmount()
  })

  it('invalidates an in-flight search immediately when a newer live query is typed', async () => {
    const api = createApi()
    const oldSearch = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const newSearch = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const oldResult = patientSummary({
      id: patientIdThree,
      patientCode: 'PT-000003',
      displayName: 'Superseded Live Result',
      givenName: 'Superseded',
      familyName: 'Live'
    })
    const newResult = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Current Live Result',
      givenName: 'Current',
      familyName: 'Live'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
      )
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(newSearch.promise)
    api.patient.get.mockImplementation(({ patientId }) =>
      Promise.resolve(
        createIpcSuccess(
          patientId === patientIdTwo
            ? patientDetail(newResult)
            : patientId === patientIdThree
              ? patientDetail(oldResult)
              : patientDetail()
        )
      )
    )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'old')
    await dispatchKeyboard(searchInput(mounted), 'Enter')

    expect(text(mounted)).toContain('Loading patients.')

    await changeInput(searchInput(mounted), 'new')

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(text(mounted)).toContain('Ada Ngono')
    expect(text(mounted)).toContain('Showing 1-1 of 1 patients.')
    expect(text(mounted)).not.toContain('Loading patients.')

    oldSearch.resolve(createIpcSuccess({ items: [oldResult], page: 1, pageSize: 25, total: 1 }))
    await flushReact()

    expect(text(mounted)).not.toContain('Superseded Live Result')
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)
    expect(dialog(mounted)).toBeNull()

    await advanceTimersByTime(299)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(text(mounted)).not.toContain('Loading patients.')

    await advanceTimersByTime(1)

    expect(api.patient.search).toHaveBeenCalledTimes(3)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'new', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('Loading patients.')

    newSearch.resolve(createIpcSuccess({ items: [newResult], page: 1, pageSize: 25, total: 1 }))
    await flushReact()

    expect(text(mounted)).toContain('Current Live Result')
    expect(text(mounted)).not.toContain('Superseded Live Result')
    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)
    expect(api.patient.get).toHaveBeenCalledTimes(2)
    expect(api.patient.get).toHaveBeenLastCalledWith({ patientId: patientIdTwo })

    await mounted.unmount()
  })

  it('does not let a superseded dirty live-search result open the guard', async () => {
    const api = createApi()
    const oldSearch = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockReturnValueOnce(oldSearch.promise).mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Current Dirty Live Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'old')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), 'new')

    oldSearch.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
    await flushReact()

    expect(dialog(mounted)).toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(text(mounted)).toContain('Ada Ngono')
    expect(text(mounted)).not.toContain('No matching patients.')
    expect(text(mounted)).not.toContain('Loading patients.')

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'new', page: 1, pageSize: 25 })
    expect(dialog(mounted)).toBeNull()
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')

    await mounted.unmount()
  })

  it('preserves a preferred reveal when a live-query change supersedes its in-flight search', async () => {
    const api = createApi()
    const staleSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const patientA = patientDetail({ displayName: 'Patient A' })
    const patientB = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Preferred Current Patient',
      givenName: 'Preferred',
      familyName: 'Current',
      createdByDisplayName: 'Preferred Current Detail Author'
    })
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(patientSummary(patientB))],
        duplicateReviewToken: 'duplicate-review-token-live-stale'
      })
    )
    api.patient.search
      .mockReturnValueOnce(staleSearch.promise)
      .mockReturnValueOnce(currentSearch.promise)
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientB))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
      selectedPatient: patientA
    })
    vi.useFakeTimers()

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')
    await changeInput(searchInput(mounted), 'preferred')

    staleSearch.resolve(
      createIpcSuccess({
        items: [patientSummary(patientA), patientSummary(patientB)],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    await flushReact()

    expect(text(mounted)).not.toContain('Preferred Current Patient')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)
    expect(api.patient.get).not.toHaveBeenCalled()

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'preferred',
      page: 1,
      pageSize: 25
    })

    currentSearch.resolve(
      createIpcSuccess({
        items: [patientSummary(patientA)],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(api.patient.get).toHaveBeenCalledTimes(1)
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdTwo })
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)
    expect(text(mounted)).toContain('Preferred Current Detail Author')

    await mounted.unmount()
  })

  it('clearing a live query immediately invalidates an older in-flight search', async () => {
    const api = createApi()
    const oldSearch = createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const defaultSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const staleResult = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Stale Clear Result',
      givenName: 'Stale',
      familyName: 'Clear'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
      )
      .mockReturnValueOnce(oldSearch.promise)
      .mockReturnValueOnce(defaultSearch.promise)
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientDetail()))

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'old')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), '')

    expect(api.patient.search).toHaveBeenCalledTimes(3)
    expect(api.patient.search).toHaveBeenLastCalledWith({ query: '', page: 1, pageSize: 25 })

    oldSearch.resolve(createIpcSuccess({ items: [staleResult], page: 1, pageSize: 25, total: 1 }))
    await flushReact()

    expect(text(mounted)).not.toContain('Stale Clear Result')

    defaultSearch.resolve(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    await flushReact()

    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Ada Ngono')

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(3)

    await mounted.unmount()
  })

  it('Search and Enter keep superseded in-flight searches from applying', async () => {
    const api = createApi()
    const staleButtonSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentButtonSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const staleEnterSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentEnterSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockReturnValueOnce(staleButtonSearch.promise)
      .mockReturnValueOnce(currentButtonSearch.promise)
      .mockReturnValueOnce(staleEnterSearch.promise)
      .mockReturnValueOnce(currentEnterSearch.promise)

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'stale button')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), 'current button')
    await clickButton(mounted, 'Search')

    staleButtonSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Stale Button Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).not.toContain('Stale Button Result')

    currentButtonSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Current Button Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).toContain('Current Button Result')

    await changeInput(searchInput(mounted), 'stale enter')
    await dispatchKeyboard(searchInput(mounted), 'Enter')
    await changeInput(searchInput(mounted), 'current enter')
    await dispatchKeyboard(searchInput(mounted), 'Enter')

    staleEnterSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Stale Enter Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).not.toContain('Stale Enter Result')

    currentEnterSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Current Enter Result' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).toContain('Current Enter Result')
    expect(api.patient.search).toHaveBeenCalledTimes(5)

    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(5)

    await mounted.unmount()
  })

  it('suppresses stale live-search responses after a newer debounced search wins', async () => {
    const api = createApi()
    const staleSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockReturnValueOnce(staleSearch.promise)
      .mockReturnValueOnce(currentSearch.promise)

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'old')
    await advanceTimersByTime(300)
    await changeInput(searchInput(mounted), 'new')
    await advanceTimersByTime(300)

    currentSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Current Live Match' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    staleSearch.resolve(
      createIpcSuccess({
        items: [patientSummary({ displayName: 'Stale Live Match' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(text(mounted)).toContain('Current Live Match')
    expect(text(mounted)).not.toContain('Stale Live Match')

    await mounted.unmount()
  })

  it('cancels pending live-search timers on unmount', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'say')
    await mounted.unmount()
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledOnce()
  })

  it('cancels pending live-search timers when IPC_FORBIDDEN clears protected state', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ patientCode: 'PT-000099', displayName: 'Protected Name' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
      .mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))

    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ patientCode: 'PT-000099', displayName: 'Protected Name' })
    })
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'forbidden')
    await clickButton(mounted, 'Search')
    await advanceTimersByTime(300)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(mounted.getSelectedPatient()).toBeNull()
    expect(text(mounted)).not.toContain('Protected Name')

    await mounted.unmount()
  })

  it('stages dirty live-search transitions and Cancel preserves the old table and draft', async () => {
    const api = createApi()
    const mounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    vi.useFakeTimers()

    await changeInput(searchInput(mounted), 'No matches')
    await advanceTimersByTime(300)

    expect(dialog(mounted)).not.toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).not.toContain('No matching patients.')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(dialog(mounted)).toBeNull()
    expect(searchInput(mounted).value).toBe('No matches')
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(text(mounted)).not.toContain('No matching patients.')

    await mounted.unmount()
  })

  it('applies dirty live-search results after Discard or successful Save', async () => {
    const api = createApi()
    const discardMounted = await mountDirtyPatientSearchWorkspace({ api })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    vi.useFakeTimers()

    await changeInput(searchInput(discardMounted), 'No matches')
    await advanceTimersByTime(300)
    await clickButtonWithin(dialog(discardMounted)!, 'Discard amendment')

    expect(text(discardMounted)).toContain('No matching patients.')
    expect(discardMounted.getSelectedPatient()).toBeNull()

    await discardMounted.unmount()
    vi.useRealTimers()

    const saveApi = createApi()
    const saveMounted = await mountDirtyPatientSearchWorkspace({ api: saveApi })
    saveApi.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    saveApi.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: patientDetail({ village: 'Dirty Village', rowVersion: 2 })
      })
    )
    vi.useFakeTimers()

    await changeInput(searchInput(saveMounted), 'No matches')
    await advanceTimersByTime(300)
    await clickButtonWithin(dialog(saveMounted)!, 'Save amendment')

    expect(saveApi.patient.amendDemographics).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: null,
      patch: expect.objectContaining({ village: 'Dirty Village' })
    })
    expect(text(saveMounted)).toContain('No matching patients.')
    expect(saveMounted.getSelectedPatient()).toBeNull()

    await saveMounted.unmount()
  })

  it('does not restart initial loading or pending debounce work on patient-search rerenders', async () => {
    const api = createApi()
    api.patient.search
      .mockResolvedValueOnce(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary({ displayName: 'Stable Timer Match' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )

    const mounted = await mountWorkspace({ api })
    vi.useFakeTimers()

    await advanceTimersByTime(1000)

    expect(api.patient.search).toHaveBeenCalledOnce()

    await changeInput(searchInput(mounted), 'stable')
    await advanceTimersByTime(150)
    await mounted.setCommandId('PATIENTS_PATIENT_SEARCH')
    await advanceTimersByTime(149)

    expect(api.patient.search).toHaveBeenCalledOnce()

    await advanceTimersByTime(1)

    expect(api.patient.search).toHaveBeenCalledTimes(2)
    expect(api.patient.search).toHaveBeenLastCalledWith({
      query: 'stable',
      page: 1,
      pageSize: 25
    })

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
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({ status: 'PATIENT_VERSION_CONFLICT', patient: latest })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )

    await clickButton(mounted, 'Save amendment')

    expect(text(mounted)).toContain('Patient changed before this amendment was saved')
    expect(text(mounted)).toContain('Latest Village')

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')

    expect(dialog(mounted)).not.toBeNull()
    expect(buttonByTextWithin(dialog(mounted)!, 'Save amendment')).toBeInstanceOf(HTMLButtonElement)
    expect(buttonByTextWithin(dialog(mounted)!, 'Discard amendment')).toBeInstanceOf(
      HTMLButtonElement
    )
    expect(buttonByTextWithin(dialog(mounted)!, 'Cancel')).toBeInstanceOf(HTMLButtonElement)
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).not.toContain('No matching patients.')

    await clickButtonWithin(dialog(mounted)!, 'Cancel')

    expect(dialog(mounted)).toBeNull()
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdOne)
    expect(fieldInput(mounted, 'Village').value).toBe('Dirty Village')
    expect(text(mounted)).toContain('Patient changed before this amendment was saved')
    expect(text(mounted)).toContain('Draft amendment')
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
    await clickButtonWithin(dialog(mounted)!, 'Discard amendment')

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
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: patientDetail({ village: 'Dirty Village', rowVersion: 2 })
      })
    )

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Save amendment')

    expect(api.patient.amendDemographics).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: null,
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
    api.patient.amendDemographics.mockResolvedValueOnce(createPatientFailure('INTERNAL_ERROR'))

    await changeInput(searchInput(mounted), 'No matches')
    await clickButton(mounted, 'Search')
    await clickButtonWithin(dialog(mounted)!, 'Save amendment')

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
    await clickButtonWithin(dialog(mounted)!, 'Discard amendment')

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

    await clickButtonWithin(dialog(mounted)!, 'Discard amendment')

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
    expect(api.patient.get).not.toHaveBeenCalled()
    expect(mounted.onSelectCommand).toHaveBeenCalledWith('PATIENTS_PATIENT_SEARCH')

    await mounted.unmount()
  })

  it('prioritizes a preferred duplicate candidate over the visible selected patient', async () => {
    const api = createApi()
    const patientA = patientDetail({
      displayName: 'Patient A',
      givenName: 'Patient',
      familyName: 'A'
    })
    const patientB = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Preferred Existing Patient',
      givenName: 'Preferred',
      familyName: 'Existing',
      createdByDisplayName: 'Preferred Detail Author'
    })
    const patientASummary = patientSummary(patientA)
    const patientBSummary = patientSummary(patientB)
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(patientBSummary)],
        duplicateReviewToken: 'duplicate-review-token-priority'
      })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientASummary, patientBSummary],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientB))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
      selectedPatient: patientA
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')

    expect(api.patient.search).toHaveBeenCalledWith({ query: '', page: 1, pageSize: 25 })
    expect(api.patient.get).toHaveBeenCalledTimes(1)
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdTwo })
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('false')
    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)
    expect(text(mounted)).toContain('Preferred Existing Patient')
    expect(text(mounted)).toContain('Preferred Detail Author')

    await mounted.unmount()
  })

  it('inserts and selects a preferred duplicate candidate absent from the backend page', async () => {
    const api = createApi()
    const patientA = patientDetail({ displayName: 'Patient A' })
    const patientB = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Inserted Preferred Patient',
      givenName: 'Inserted',
      familyName: 'Preferred',
      createdByDisplayName: 'Inserted Detail Author'
    })
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(patientSummary(patientB))],
        duplicateReviewToken: 'duplicate-review-token-insert'
      })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary(patientA)],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientB))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
      selectedPatient: patientA
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')

    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('false')
    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(api.patient.get).toHaveBeenCalledTimes(1)
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdTwo })
    expect(mounted.getSelectedPatient()?.id).toBe(patientIdTwo)
    expect(text(mounted)).toContain('Inserted Detail Author')

    await mounted.unmount()
  })

  it('does not let a stale search consume the preferred duplicate reveal', async () => {
    const api = createApi()
    const staleSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const currentSearch =
      createDeferred<Awaited<ReturnType<HealthScreeningApi['patient']['search']>>>()
    const patientA = patientDetail({ displayName: 'Patient A' })
    const patientB = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Stale-Protected Preferred Patient',
      givenName: 'Stale-Protected',
      familyName: 'Preferred',
      createdByDisplayName: 'Stale-Protected Detail Author'
    })
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(patientSummary(patientB))],
        duplicateReviewToken: 'duplicate-review-token-stale'
      })
    )
    api.patient.search
      .mockReturnValueOnce(staleSearch.promise)
      .mockReturnValueOnce(currentSearch.promise)
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientB))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
      selectedPatient: patientA
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')
    await dispatchKeyboard(searchInput(mounted), 'Enter')

    staleSearch.resolve(
      createIpcSuccess({
        items: [patientSummary(patientA), patientSummary(patientB)],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    await flushReact()

    expect(text(mounted)).not.toContain('Stale-Protected Preferred Patient')

    currentSearch.resolve(
      createIpcSuccess({
        items: [patientSummary(patientA)],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(patientRowByCode(mounted, 'PT-000002').getAttribute('aria-selected')).toBe('true')
    expect(api.patient.get).toHaveBeenCalledTimes(1)
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdTwo })
    expect(text(mounted)).toContain('Stale-Protected Detail Author')

    await mounted.unmount()
  })

  it('clears a preferred duplicate reveal on IPC_FORBIDDEN search failure', async () => {
    const api = createApi()
    const patientA = patientDetail({ displayName: 'Patient A' })
    const patientB = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Forbidden Preferred Patient',
      givenName: 'Forbidden',
      familyName: 'Preferred'
    })
    api.patient.create.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'DUPLICATE_REVIEW_REQUIRED',
        candidates: [duplicateCandidate(patientSummary(patientB))],
        duplicateReviewToken: 'duplicate-review-token-forbidden'
      })
    )
    api.patient.search
      .mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [patientSummary(patientA)],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(patientA))

    const mounted = await mountWorkspace({
      api,
      commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
      selectedPatient: patientA
    })

    await fillExactDobRegistration(mounted)
    await clickButton(mounted, 'Create patient')
    await clickButton(mounted, 'Open existing patient')

    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(mounted.getSelectedPatient()).toBeNull()

    await clickButton(mounted, 'Search')

    expect(text(mounted)).toContain('Patient A')
    expect(text(mounted)).not.toContain('PT-000002')
    expect(api.patient.get).toHaveBeenCalledTimes(1)
    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })

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
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({ status: 'AMENDED', amendmentId, patient: updated })
    )

    const mounted = await mountWorkspace({ api })

    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })
    expect(patientRowByCode(mounted, 'PT-000001').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('PT-000001')

    await clickButton(mounted, 'Amend demographics')
    await changeInput(fieldInput(mounted, 'Given name'), 'Ada Edited')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await clickButton(mounted, 'Save amendment')

    expect(api.patient.amendDemographics).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: null,
      patch: { givenName: 'Ada Edited' }
    })
    expect(text(mounted)).toContain('Demographic amendment recorded.')
    expect(text(mounted)).toContain('Ada Edited')
    expect(text(mounted)).not.toContain('Draft amendment')
    expect(api.patient.update).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('validates demographic amendment fields before invoking IPC', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickButton(mounted, 'Amend demographics')
    await clickButton(mounted, 'Save amendment')

    expect(api.patient.amendDemographics).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Change at least one demographic field before saving.')
    expect(text(mounted)).toContain('Select a reason for this demographic amendment.')
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Review the demographic amendment'
    )

    await changeInput(fieldInput(mounted, 'Village'), 'Bamenda')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'OTHER')
    await clickButton(mounted, 'Save amendment')

    expect(api.patient.amendDemographics).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('Enter a reason note when Other is selected.')

    await mounted.unmount()
  })

  it('prevents trained screeners from changing status while allowing ordinary amendments', async () => {
    const api = createApi()
    const updated = patientDetail({ village: 'Screener Village', rowVersion: 2 })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({ status: 'AMENDED', amendmentId, patient: updated })
    )
    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ status: 'ACTIVE' }),
      userRole: 'TRAINED_SCREENER'
    })

    await clickButton(mounted, 'Amend demographics')

    const statusSelect = fieldSelect(mounted, 'Status')
    expect(statusSelect.disabled).toBe(true)
    expect(statusSelect.getAttribute('aria-describedby')).toContain(
      'patient-amendment-status-restriction'
    )
    expect(text(mounted)).toContain(
      'Only nurses and local administrators can change patient status.'
    )

    await changeSelect(statusSelect, 'INACTIVE')
    await changeInput(fieldInput(mounted, 'Village'), 'Screener Village')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await clickButton(mounted, 'Save amendment')

    expect(api.patient.amendDemographics).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: null,
      patch: { village: 'Screener Village' }
    })
    expect(api.patient.update).not.toHaveBeenCalled()

    await mounted.unmount()
  })

  it('renders accessible selected-patient tabs with manual keyboard activation', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory.mockResolvedValueOnce(
      createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 })
    )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    expect(detailTabs(mounted).map((tab) => normalizedText(tab))).toEqual([
      'Current Details',
      'Demographic History',
      'Acknowledgment History',
      'Identifiers'
    ])
    expect(tabByText(mounted, 'Current Details').getAttribute('aria-selected')).toBe('true')
    expect(activeTabPanel(mounted).getAttribute('aria-labelledby')).toBe(
      tabByText(mounted, 'Current Details').id
    )
    expect(text(mounted)).toContain('Clinical')

    const currentTab = tabByText(mounted, 'Current Details')
    currentTab.focus()
    await dispatchKeyboard(currentTab, 'ArrowRight')

    expect(document.activeElement).toBe(tabByText(mounted, 'Demographic History'))
    expect(tabByText(mounted, 'Current Details').getAttribute('aria-selected')).toBe('true')
    expect(api.patient.listDemographicAmendmentHistory).not.toHaveBeenCalled()

    await dispatchKeyboard(tabByText(mounted, 'Demographic History'), 'End')
    expect(document.activeElement).toBe(tabByText(mounted, 'Identifiers'))

    await dispatchKeyboard(tabByText(mounted, 'Identifiers'), 'Home')
    expect(document.activeElement).toBe(tabByText(mounted, 'Current Details'))

    await dispatchKeyboard(tabByText(mounted, 'Current Details'), 'ArrowRight')
    await dispatchKeyboard(tabByText(mounted, 'Demographic History'), 'Enter')

    expect(tabByText(mounted, 'Demographic History').getAttribute('aria-selected')).toBe('true')
    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain('No demographic amendments recorded.')
    expect(activeTabPanel(mounted).textContent).not.toContain('Clinical')

    await mounted.unmount()
  })

  it('loads, pages, and formats demographic amendment history after tab activation', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [demographicAmendmentRecord()],
          page: 1,
          pageSize: 25,
          total: 30
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [
            demographicAmendmentRecord({
              priorRowVersion: 2,
              resultingRowVersion: 3,
              reasonCode: 'STATUS_CHANGE',
              changes: [
                {
                  fieldName: 'status',
                  previousValue: 'ACTIVE',
                  newValue: 'INACTIVE'
                }
              ]
            })
          ],
          page: 2,
          pageSize: 25,
          total: 30
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [demographicAmendmentRecord({ amendedAt: '2026-08-04T13:00:00.000Z' })],
          page: 1,
          pageSize: 50,
          total: 30
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [demographicAmendmentRecord({ amendedAt: '2026-08-05T13:00:00.000Z' })],
          page: 1,
          pageSize: 100,
          total: 30
        })
      )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    expect(api.patient.listDemographicAmendmentHistory).not.toHaveBeenCalled()

    await clickElement(tabByText(mounted, 'Demographic History'))

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain(
      'Showing 1-25 of 30 demographic amendments.'
    )
    expect(activeTabPanel(mounted).textContent).toContain('Data entry correction')
    expect(activeTabPanel(mounted).textContent).toContain('Given name')
    expect(activeTabPanel(mounted).textContent).toContain('Not recorded')
    expect(activeTabPanel(mounted).textContent).not.toContain('given_name')
    expect(activeTabPanel(mounted).textContent).not.toContain(amendmentId)

    await clickButtonWithin(activeTabPanel(mounted), 'Next')

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenLastCalledWith({
      patientId: patientIdOne,
      page: 2,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain('Status change')
    expect(activeTabPanel(mounted).textContent).toContain('Version 2 to 3')

    await changeSelect(historyPageSizeSelect(mounted, 'Demographic history page size'), '50')

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenLastCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 50
    })

    await changeSelect(historyPageSizeSelect(mounted, 'Demographic history page size'), '100')

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenLastCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 100
    })

    await mounted.unmount()
  })

  it('shows demographic history failures and retries the requested page', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory
      .mockResolvedValueOnce(createPatientFailure('INTERNAL_ERROR'))
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [demographicAmendmentRecord({ reasonNote: 'Retry succeeded.' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickElement(tabByText(mounted, 'Demographic History'))

    expect(activeTabPanel(mounted).querySelector('[role="alert"]')?.textContent).toContain(
      'The application could not complete the request.'
    )

    await clickButtonWithin(activeTabPanel(mounted), 'Retry')

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenLastCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain('Retry succeeded.')

    await mounted.unmount()
  })

  it('loads acknowledgment history with legacy version display and no physical consent terms', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listAcknowledgmentHistory.mockResolvedValueOnce(
      createIpcSuccess({
        items: [
          acknowledgmentHistoryRecord({
            status: 'DECLINED',
            note: 'Patient declined participation.',
            priorRowVersion: 2,
            resultingRowVersion: 3
          }),
          acknowledgmentHistoryRecord({
            acknowledgmentId: '77777777-7777-4777-8777-777777777777',
            status: 'NOT_REQUESTED',
            note: null,
            priorRowVersion: null,
            resultingRowVersion: null
          })
        ],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickElement(tabByText(mounted, 'Acknowledgment History'))

    expect(api.patient.listAcknowledgmentHistory).toHaveBeenCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain('Declined')
    expect(activeTabPanel(mounted).textContent).toContain('Not requested')
    expect(activeTabPanel(mounted).textContent).toContain('Patient declined participation.')
    expect(activeTabPanel(mounted).textContent).toContain('Version information not available')
    expect(activeTabPanel(mounted).textContent).not.toContain(acknowledgmentId)
    expect(activeTabPanel(mounted).textContent?.toLowerCase()).not.toContain('consent')

    await mounted.unmount()
  })

  it('keeps demographic and acknowledgment history requests independent across tab switches', async () => {
    const api = createApi()
    const demographic =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['patient']['listDemographicAmendmentHistory']>>
      >()
    const acknowledgment =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['patient']['listAcknowledgmentHistory']>>
      >()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory.mockReturnValueOnce(demographic.promise)
    api.patient.listAcknowledgmentHistory.mockReturnValueOnce(acknowledgment.promise)
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickElement(tabByText(mounted, 'Demographic History'))
    await clickElement(tabByText(mounted, 'Acknowledgment History'))

    demographic.resolve(
      createIpcSuccess({
        items: [demographicAmendmentRecord({ reasonNote: 'Late demographic result.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(activeTabPanel(mounted).textContent).not.toContain('Late demographic result.')

    acknowledgment.resolve(
      createIpcSuccess({
        items: [acknowledgmentHistoryRecord({ note: 'Active acknowledgment result.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(activeTabPanel(mounted).textContent).toContain('Active acknowledgment result.')

    await clickElement(tabByText(mounted, 'Demographic History'))

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledOnce()
    expect(activeTabPanel(mounted).textContent).toContain('Late demographic result.')

    await mounted.unmount()
  })

  it('refreshes demographic history after a successful amendment and preserves acknowledgment history', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [demographicAmendmentRecord({ reasonNote: 'Before amendment.' })],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({
          items: [
            demographicAmendmentRecord({
              priorRowVersion: 2,
              resultingRowVersion: 3,
              reasonNote: 'After amendment.'
            })
          ],
          page: 1,
          pageSize: 25,
          total: 1
        })
      )
    api.patient.listAcknowledgmentHistory.mockResolvedValueOnce(
      createIpcSuccess({
        items: [acknowledgmentHistoryRecord({ note: 'Acknowledgment stays cached.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: patientDetail({ village: 'Updated Village', rowVersion: 2 })
      })
    )
    const mounted = await mountWorkspace({
      api,
      selectedPatient: patientDetail({ village: 'Old Village' })
    })

    await clickElement(tabByText(mounted, 'Demographic History'))
    expect(activeTabPanel(mounted).textContent).toContain('Before amendment.')

    await clickElement(tabByText(mounted, 'Acknowledgment History'))
    expect(activeTabPanel(mounted).textContent).toContain('Acknowledgment stays cached.')

    await clickElement(tabByText(mounted, 'Current Details'))
    await clickButton(mounted, 'Amend demographics')
    await changeInput(fieldInput(mounted, 'Village'), 'Updated Village')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await clickButton(mounted, 'Save amendment')

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledOnce()
    expect(api.patient.listAcknowledgmentHistory).toHaveBeenCalledOnce()

    await clickElement(tabByText(mounted, 'Demographic History'))

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledTimes(2)
    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenLastCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })
    expect(activeTabPanel(mounted).textContent).toContain('After amendment.')
    expect(api.patient.listAcknowledgmentHistory).toHaveBeenCalledOnce()

    await mounted.unmount()
  })

  it('ignores stale demographic history after selecting a different patient', async () => {
    const api = createApi()
    const staleHistory =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['patient']['listDemographicAmendmentHistory']>>
      >()
    const first = patientDetail()
    const second = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary(first), patientSummary(second)],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    api.patient.listDemographicAmendmentHistory.mockReturnValueOnce(staleHistory.promise)
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(second))
    const mounted = await mountWorkspace({ api, selectedPatient: first })

    await clickElement(tabByText(mounted, 'Demographic History'))
    await clickButtonWithin(patientRowByCode(mounted, 'PT-000002'), 'Select')

    staleHistory.resolve(
      createIpcSuccess({
        items: [demographicAmendmentRecord({ reasonNote: 'Stale demographic history.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(tabByText(mounted, 'Current Details').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Brice Muna')
    expect(text(mounted)).not.toContain('Stale demographic history.')

    await mounted.unmount()
  })

  it('ignores stale acknowledgment history after selecting a different patient', async () => {
    const api = createApi()
    const staleHistory =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['patient']['listAcknowledgmentHistory']>>
      >()
    const first = patientDetail()
    const second = patientDetail({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({
        items: [patientSummary(first), patientSummary(second)],
        page: 1,
        pageSize: 25,
        total: 2
      })
    )
    api.patient.listAcknowledgmentHistory.mockReturnValueOnce(staleHistory.promise)
    api.patient.get.mockResolvedValueOnce(createIpcSuccess(second))
    const mounted = await mountWorkspace({ api, selectedPatient: first })

    await clickElement(tabByText(mounted, 'Acknowledgment History'))
    await clickButtonWithin(patientRowByCode(mounted, 'PT-000002'), 'Select')

    staleHistory.resolve(
      createIpcSuccess({
        items: [acknowledgmentHistoryRecord({ note: 'Stale acknowledgment history.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(tabByText(mounted, 'Current Details').getAttribute('aria-selected')).toBe('true')
    expect(text(mounted)).toContain('Brice Muna')
    expect(text(mounted)).not.toContain('Stale acknowledgment history.')

    await mounted.unmount()
  })

  it('ignores history results that resolve after the workspace unmounts', async () => {
    const api = createApi()
    const staleHistory =
      createDeferred<
        Awaited<ReturnType<HealthScreeningApi['patient']['listDemographicAmendmentHistory']>>
      >()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory.mockReturnValueOnce(staleHistory.promise)
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickElement(tabByText(mounted, 'Demographic History'))
    await mounted.unmount()

    staleHistory.resolve(
      createIpcSuccess({
        items: [demographicAmendmentRecord({ reasonNote: 'Unmounted history result.' })],
        page: 1,
        pageSize: 25,
        total: 1
      })
    )
    await flushReact()

    expect(api.patient.listDemographicAmendmentHistory).toHaveBeenCalledOnce()
  })

  it('clears selected patient and history state when a history load is authentication-protected', async () => {
    const api = createApi()
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary()], page: 1, pageSize: 25, total: 1 })
    )
    api.patient.listDemographicAmendmentHistory.mockResolvedValueOnce(
      createPatientFailure('IPC_FORBIDDEN')
    )
    const mounted = await mountWorkspace({ api, selectedPatient: patientDetail() })

    await clickElement(tabByText(mounted, 'Demographic History'))

    expect(mounted.onAuthenticationFailure).toHaveBeenCalledWith('IPC_FORBIDDEN')
    expect(mounted.getSelectedPatient()).toBeNull()
    expect(text(mounted)).toContain('Select a patient to view or update details.')
    expect(detailTabs(mounted)).toEqual([])

    await mounted.unmount()
  })

  it('guards dirty Current Details tab transitions with Save, Discard, and Cancel', async () => {
    const cancelApi = createApi()
    const cancelMounted = await mountDirtyPatientSearchWorkspace({ api: cancelApi })

    await clickElement(tabByText(cancelMounted, 'Demographic History'))

    expect(dialog(cancelMounted)).not.toBeNull()
    await clickButtonWithin(dialog(cancelMounted)!, 'Cancel')

    expect(tabByText(cancelMounted, 'Current Details').getAttribute('aria-selected')).toBe('true')
    expect(fieldInput(cancelMounted, 'Village').value).toBe('Dirty Village')

    await clickElement(tabByText(cancelMounted, 'Demographic History'))
    await clickButtonWithin(dialog(cancelMounted)!, 'Discard amendment')

    expect(tabByText(cancelMounted, 'Demographic History').getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(activeTabPanel(cancelMounted).textContent).toContain(
      'No demographic amendments recorded.'
    )

    await cancelMounted.unmount()

    const saveApi = createApi()
    const saveMounted = await mountDirtyPatientSearchWorkspace({ api: saveApi })
    saveApi.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({
        status: 'AMENDED',
        amendmentId,
        patient: patientDetail({ village: 'Dirty Village', rowVersion: 2 })
      })
    )

    await clickElement(tabByText(saveMounted, 'Acknowledgment History'))
    await clickButtonWithin(dialog(saveMounted)!, 'Save amendment')

    expect(saveApi.patient.amendDemographics).toHaveBeenCalledWith({
      patientId: patientIdOne,
      expectedRowVersion: 1,
      reasonCode: 'DATA_ENTRY_CORRECTION',
      reasonNote: null,
      patch: expect.objectContaining({ village: 'Dirty Village' })
    })
    expect(tabByText(saveMounted, 'Acknowledgment History').getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(saveApi.patient.listAcknowledgmentHistory).toHaveBeenCalledWith({
      patientId: patientIdOne,
      page: 1,
      pageSize: 25
    })

    await saveMounted.unmount()

    const failedSaveApi = createApi()
    const failedSaveMounted = await mountDirtyPatientSearchWorkspace({ api: failedSaveApi })
    failedSaveApi.patient.amendDemographics.mockResolvedValueOnce(
      createPatientFailure('INTERNAL_ERROR')
    )

    await clickElement(tabByText(failedSaveMounted, 'Demographic History'))
    await clickButtonWithin(dialog(failedSaveMounted)!, 'Save amendment')

    expect(tabByText(failedSaveMounted, 'Current Details').getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(fieldInput(failedSaveMounted, 'Village').value).toBe('Dirty Village')
    expect(text(failedSaveMounted)).toContain('The application could not complete the request.')

    await failedSaveMounted.unmount()
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
    api.patient.amendDemographics.mockResolvedValueOnce(
      createIpcSuccess({ status: 'PATIENT_VERSION_CONFLICT', patient: latest })
    )
    api.patient.search.mockResolvedValueOnce(
      createIpcSuccess({ items: [patientSummary(original)], page: 1, pageSize: 25, total: 1 })
    )

    const mounted = await mountWorkspace({ api, selectedPatient: original })

    await clickButton(mounted, 'Amend demographics')
    await changeInput(fieldInput(mounted, 'Village'), 'Attempted Village')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    await clickButton(mounted, 'Save amendment')

    expect(text(mounted)).toContain('The patient changed after you opened it.')
    expect(text(mounted)).toContain('Patient changed before this amendment was saved')
    expect(text(mounted)).toContain('Latest Village')
    expect(fieldInput(mounted, 'Village').value).toBe('Attempted Village')
    expect(text(mounted)).toContain('Draft amendment')

    await clickButton(mounted, 'Review rebased amendment')

    expect(fieldInput(mounted, 'Village').value).toBe('Attempted Village')
    expect(text(mounted)).not.toContain('Patient changed before this amendment was saved')

    await mounted.unmount()
  })

  it('guards dirty workspace navigation, traps dialog focus, blocks Escape while saving, and resumes after save', async () => {
    const api = createApi()
    const failedSave = createDeferred<PatientAmendDemographicsResult>()
    const savedPatient = patientDetail({ village: 'Saved Village', rowVersion: 2 })
    api.patient.amendDemographics
      .mockReturnValueOnce(failedSave.promise)
      .mockResolvedValueOnce(
        createIpcSuccess({ status: 'AMENDED', amendmentId, patient: savedPatient })
      )
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

    await clickButton(mounted, 'Amend demographics')
    const villageInput = fieldInput(mounted, 'Village')
    await changeInput(villageInput, 'Dirty Village')
    await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
    villageInput.focus()

    expect(await mounted.runNavigationGuard('HOME_DASHBOARD')).toBe(false)
    expect(dialog(mounted)?.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(dialogHeading(mounted))

    await dispatchKeyboard(dialog(mounted)!, 'Escape')

    expect(dialog(mounted)).toBeNull()
    expect(document.activeElement).toBe(villageInput)
    expect(mounted.onSelectCommand).not.toHaveBeenCalled()

    expect(await mounted.runNavigationGuard('HOME_DASHBOARD')).toBe(false)
    await clickButtonWithin(dialog(mounted)!, 'Save amendment')
    await dispatchKeyboard(dialog(mounted)!, 'Escape')

    expect(dialog(mounted)).not.toBeNull()

    failedSave.resolve(createPatientFailure('INTERNAL_ERROR'))
    await flushReact()

    expect(dialog(mounted)).not.toBeNull()
    expect(mounted.onSelectCommand).not.toHaveBeenCalled()
    expect(text(mounted)).toContain('The application could not complete the request.')

    await clickButtonWithin(dialog(mounted)!, 'Save amendment')

    expect(mounted.onSelectCommand).toHaveBeenCalledWith('HOME_DASHBOARD')
    expect(dialog(mounted)).toBeNull()
    expect(text(mounted)).toContain('Demographic amendment recorded.')

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
          api.patient.amendDemographics.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async (mounted) => {
          await clickButton(mounted, 'Amend demographics')
          await changeInput(fieldInput(mounted, 'Given name'), 'Forbidden Edit')
          await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')
          await clickButton(mounted, 'Save amendment')
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
  userRole = 'LOCAL_ADMIN',
  onAuthenticationFailure = vi.fn<(code: PatientErrorCode) => void>(),
  onSelectCommand = vi.fn<(commandId: ApplicationCommandId) => void>()
}: {
  readonly api?: MockedHealthScreeningApi
  readonly commandId?: PatientCommandId
  readonly selectedPatient?: PublicPatientDetail | null
  readonly userRole?: LocalUserRole
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
        userRole,
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

  await clickButton(mounted, 'Amend demographics')
  await changeInput(fieldInput(mounted, 'Village'), draftVillage)
  await changeSelect(fieldSelect(mounted, 'Reason'), 'DATA_ENTRY_CORRECTION')

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
      amendDemographics: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      listDemographicAmendmentHistory: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      ),
      recordAcknowledgment: vi.fn(() => Promise.resolve(createPatientFailure('IPC_UNAVAILABLE'))),
      listAcknowledgmentHistory: vi.fn(() =>
        Promise.resolve(createIpcSuccess({ items: [], page: 1, pageSize: 25, total: 0 }))
      ),
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

function demographicAmendmentRecord(
  overrides: Partial<PublicPatientDemographicAmendmentRecord> = {}
): PublicPatientDemographicAmendmentRecord {
  return {
    amendmentId,
    patientId: patientIdOne,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: 'Corrected synthetic demographic details.',
    amendedByUserId: actorId,
    amendedByDisplayName: 'Admin User',
    amendedAt: baseTimestamp,
    changes: [
      {
        fieldName: 'givenName',
        previousValue: null,
        newValue: 'Ada'
      },
      {
        fieldName: 'phone',
        previousValue: '+237 600 000 000',
        newValue: '+237 600 000 001'
      }
    ],
    ...overrides
  }
}

function acknowledgmentHistoryRecord(
  overrides: Partial<PublicPatientAcknowledgmentHistoryRecord> = {}
): PublicPatientAcknowledgmentHistoryRecord {
  return {
    acknowledgmentId,
    patientId: patientIdOne,
    status: 'ACKNOWLEDGED',
    sourceType: 'LOCAL',
    note: 'Patient acknowledged participation.',
    recordedByUserId: actorId,
    recordedByDisplayName: 'Admin User',
    recordedAt: baseTimestamp,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    ...overrides
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

function historyPageSizeSelect(mounted: MountedWorkspace, label: string): HTMLSelectElement {
  const select = mounted.container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)

  if (select === null) {
    throw new Error(`Expected history page-size select ${label} to be rendered.`)
  }

  return select
}

function detailTabs(mounted: MountedWorkspace): HTMLButtonElement[] {
  return Array.from(
    mounted.container.querySelectorAll<HTMLButtonElement>('[role="tablist"] [role="tab"]')
  )
}

function tabByText(mounted: MountedWorkspace, label: string): HTMLButtonElement {
  const tab = detailTabs(mounted).find((candidate) => normalizedText(candidate) === label)

  if (tab === undefined) {
    throw new Error(`Expected detail tab ${label} to be rendered.`)
  }

  return tab
}

function activeTabPanel(mounted: MountedWorkspace): HTMLElement {
  const panel = mounted.container.querySelector<HTMLElement>('[role="tabpanel"]')

  if (panel === null) {
    throw new Error('Expected active patient detail tab panel to be rendered.')
  }

  return panel
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

function fieldSelect(mounted: MountedWorkspace, label: string): HTMLSelectElement {
  const field = fieldControl<HTMLSelectElement>(mounted, label, 'select')

  if (field === null) {
    throw new Error(`Expected select field ${label} to be rendered.`)
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

async function advanceTimersByTime(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
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
