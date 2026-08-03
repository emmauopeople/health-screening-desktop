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

  it('runs patient search only on explicit Search or Enter and paginates results', async () => {
    const api = createApi()
    const firstPage = patientSummary({ id: patientIdOne, displayName: 'Ada Ngono' })
    const secondPage = patientSummary({
      id: patientIdTwo,
      patientCode: 'PT-000002',
      displayName: 'Brice Muna',
      givenName: 'Brice',
      familyName: 'Muna'
    })
    api.patient.search
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [firstPage], page: 1, pageSize: 25, total: 30 })
      )
      .mockResolvedValueOnce(
        createIpcSuccess({ items: [secondPage], page: 2, pageSize: 25, total: 30 })
      )

    const mounted = await mountWorkspace({ api })

    expect(api.patient.search).not.toHaveBeenCalled()
    expect(searchLabel(mounted).textContent).toBe('Patient search')

    await changeInput(searchInput(mounted), 'Ada')

    expect(api.patient.search).not.toHaveBeenCalled()

    await clickButton(mounted, 'Search')

    expect(api.patient.search).toHaveBeenCalledWith({ query: 'Ada', page: 1, pageSize: 25 })
    expect(text(mounted)).toContain('Ada Ngono')

    await clickButton(mounted, 'Next')

    expect(api.patient.search).toHaveBeenLastCalledWith({ query: 'Ada', page: 2, pageSize: 25 })
    expect(text(mounted)).toContain('Brice Muna')
    expect(text(mounted)).not.toContain('Ada Ngono')
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

    await clickButton(mounted, 'Search')
    await clickButton(mounted, 'Select')

    expect(api.patient.get).toHaveBeenCalledWith({ patientId: patientIdOne })
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
        run: async (mounted) => {
          await clickButton(mounted, 'Search')
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
        run: async (mounted) => {
          await clickButton(mounted, 'Search')
          await clickButton(mounted, 'Select')
        }
      },
      {
        name: 'create',
        commandId: 'PATIENTS_REGISTER_NEW_PATIENT',
        configure: (api) => {
          api.patient.create.mockResolvedValueOnce(createPatientFailure('IPC_FORBIDDEN'))
        },
        run: async (mounted) => {
          await clickButton(mounted, 'Create patient')
        }
      },
      {
        name: 'update',
        commandId: 'PATIENTS_PATIENT_SEARCH',
        configure: (api) => {
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
    await clickButton(mounted, 'Select')
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

function fieldInput(mounted: MountedWorkspace, label: string): HTMLInputElement {
  const field = fieldControl<HTMLInputElement>(mounted, label, 'input')

  if (field === null) {
    throw new Error(`Expected input field ${label} to be rendered.`)
  }

  return field
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
