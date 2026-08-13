import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { LifestyleWorkspaceSummary, ScreeningLifestyleService } from '@main/application'
import { createScreeningLifestyleIpcHandlers } from '@main/ipc/handlers/screening-lifestyle-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess } from '@shared/ipc'

const encounterId = '33333333-3333-4333-8333-333333333333'
const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }
const request = {
  encounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivities: []
}
const workspace: LifestyleWorkspaceSummary = {
  encounterId: encounterId as LifestyleWorkspaceSummary['encounterId'],
  draft: null,
  activeAlcoholBaseline: null,
  activeTobaccoBaseline: null,
  activeWorkBaseline: null,
  referencedAlcoholBaseline: null,
  referencedTobaccoBaseline: null,
  referencedWorkBaseline: null
}

describe('screening Lifestyle IPC handlers', () => {
  it('calls each matching L3A operation and preserves controlled statuses', async () => {
    const service = createService()
    const handlers = createHandlers(service)

    const loaded = await createHandlers(createService({ workspace })).getWorkspace(event, {
      encounterId
    })
    expect(loaded).toEqual(createIpcSuccess({ status: 'LOADED', workspace }))

    await handlers.getWorkspace(event, { encounterId })
    await handlers.saveAlcoholBaseline(event, {
      encounterId,
      expectedBaselineVersion: null,
      expectedDraftVersion: null,
      status: 'CURRENT',
      everConsumed: 'YES',
      consumedPast12Months: 'YES',
      commonBeverageTypes: [],
      otherBeverageDescription: null
    })
    await handlers.saveTobaccoBaseline(event, {
      encounterId,
      expectedBaselineVersion: null,
      expectedDraftVersion: null,
      status: 'NEVER',
      everRegularlyUsed: 'NO',
      formerUseApproximateStopDate: null,
      currentUseFrequency: 'NOT_AT_ALL',
      productTypes: [],
      otherProductDescription: null
    })
    await handlers.saveWorkBaseline(event, {
      encounterId,
      expectedBaselineVersion: null,
      expectedDraftVersion: null,
      status: 'EMPLOYED',
      occupationJobTitle: null,
      usualPhysicalDemand: null,
      typicalWorkdaysPerWeek: null,
      typicalHoursPerWorkday: null,
      shiftPattern: null,
      description: null
    })
    await handlers.saveDraft(event, request)
    await handlers.complete(event, {
      ...request,
      alcoholBaselineReviewConfirmedVersionId: null,
      tobaccoBaselineReviewConfirmedVersionId: null
    })

    expect(service.getLifestyleWorkspace).toHaveBeenCalledWith({ encounterId })
    expect(service.saveAlcoholBaseline).toHaveBeenCalledOnce()
    expect(service.saveTobaccoBaseline).toHaveBeenCalledOnce()
    expect(service.saveWorkBaseline).toHaveBeenCalledOnce()
    expect(service.saveLifestyleDraft).toHaveBeenCalledOnce()
    expect(service.completeLifestyle).toHaveBeenCalledOnce()
  })

  it('rejects untrusted senders before inspecting the request', async () => {
    const service = createService()
    const handlers = createHandlers(service)
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('secret')
        }
      }
    )
    const forbiddenFrame = { url: 'https://example.invalid/' }
    await expect(
      handlers.saveDraft(
        { sender: { mainFrame: forbiddenFrame }, senderFrame: forbiddenFrame },
        hostile
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_FORBIDDEN' }
    })
    expect(service.saveLifestyleDraft).not.toHaveBeenCalled()
  })

  it('maps service failures without leaking internals', async () => {
    const service = createService({ result: { status: 'VERSION_CONFLICT' } })
    const handlers = createHandlers(service)
    await expect(handlers.saveDraft(event, request)).resolves.toEqual(
      createIpcSuccess({ status: 'VERSION_CONFLICT' as const })
    )
    const thrown = createService({
      implementation: () => {
        throw new Error('C:\\secret\\db.sqlite SELECT')
      }
    })
    const result = await createHandlers(thrown).saveDraft(event, request)
    expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})

function createHandlers(
  service: ScreeningLifestyleService
): ReturnType<typeof createScreeningLifestyleIpcHandlers> {
  return createScreeningLifestyleIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    screeningLifestyleService: service
  })
}

function createService(
  overrides: {
    result?: { status: 'UNAVAILABLE' | 'VERSION_CONFLICT' }
    implementation?: () => never
    workspace?: LifestyleWorkspaceSummary
  } = {}
): ScreeningLifestyleService {
  const result = overrides.result ?? { status: 'UNAVAILABLE' as const }
  const implementation = overrides.implementation
  return {
    getLifestyleWorkspace: vi.fn(() =>
      overrides.workspace ? { status: 'LOADED' as const, workspace: overrides.workspace } : result
    ),
    saveAlcoholBaseline: vi.fn(() => result),
    saveTobaccoBaseline: vi.fn(() => result),
    saveWorkBaseline: vi.fn(() => result),
    saveLifestyleDraft: vi.fn(() => (implementation ? implementation() : result)),
    completeLifestyle: vi.fn(() => result)
  } as unknown as ScreeningLifestyleService
}
