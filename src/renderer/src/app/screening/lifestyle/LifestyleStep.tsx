import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'
import { useEffect, useRef } from 'react'

import { AlcoholCard } from './AlcoholCard'
import { TobaccoCard } from './TobaccoCard'
import { PhysicalActivityCard } from './PhysicalActivityCard'
import { WorkCard } from './WorkCard'
import { OtherActivityCard } from './OtherActivityCard'
import {
  getAlcoholCardStatus,
  toggleLifestyleCard,
  validateAlcoholBaseline,
  getAlcoholBaselineForInterpretation,
  getTobaccoBaselineForInterpretation,
  validateAlcoholWeeklyDraft,
  type AlcoholBaselineForm,
  type AlcoholWeeklyForm,
  type LifestyleDraftState
} from './lifestyle-workspace-model'
import {
  validateOtherActivity,
  validatePhysicalActivity,
  validateWorkBaseline,
  type OtherActivityForm,
  type PhysicalActivityForm,
  type WorkBaselineForm,
  type WorkWeeklyForm
} from './activity-workspace-model'
import {
  validateTobaccoBaseline,
  validateTobaccoWeeklyDraft,
  type TobaccoBaselineForm,
  type TobaccoWeeklyForm
} from './lifestyle-workspace-model'

export interface LifestyleStepProps {
  readonly encounterId: string
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  readonly state: LifestyleDraftState
  onBackToVitals(): void
  onRetryLoad(): void
  onReload(): void
  onUpdate(update: (state: LifestyleDraftState) => LifestyleDraftState): void
  onSaveBaseline(): void
  onSaveTobaccoBaseline(): void
  onSaveWorkBaseline(): void
  onSaveDraft(): void
  onContinue(): void
  onReopen(): void
}

export function LifestyleStep({
  encounterStatus,
  state,
  onBackToVitals,
  onRetryLoad,
  onReload,
  onUpdate,
  onSaveBaseline,
  onSaveTobaccoBaseline,
  onSaveWorkBaseline,
  onContinue,
  onSaveDraft,
  onReopen
}: LifestyleStepProps): React.JSX.Element {
  const lifestyleCompleted = state.workspace?.draft?.status === 'COMPLETE'
  const editable = encounterStatus === 'DRAFT' && !lifestyleCompleted
  const controlsDisabled = !editable || state.saveStatus === 'SAVING'
  const cardStatus = getAlcoholCardStatus(state, editable)
  const canSave = state.loadStatus === 'READY' && !controlsDisabled
  const canReopen =
    encounterStatus === 'DRAFT' &&
    lifestyleCompleted &&
    state.loadStatus === 'READY' &&
    state.saveStatus !== 'SAVING'
  const consumedValidationFocusTokens = useRef<Set<string>>(new Set())
  const {
    validationFocusRequestToken,
    validationErrors,
    tobaccoValidationErrors,
    physicalActivityValidationErrors,
    workValidationErrors,
    otherActivityValidationErrors,
    alcoholExpanded,
    baselineOpen,
    tobaccoExpanded,
    tobaccoBaselineOpen,
    physicalActivityExpanded,
    workExpanded,
    workBaselineOpen,
    otherActivityExpanded
  } = state

  useEffect(() => {
    if (
      validationFocusRequestToken === null ||
      consumedValidationFocusTokens.current.has(validationFocusRequestToken)
    )
      return
    const firstError = [
      ...validationErrors,
      ...tobaccoValidationErrors,
      ...physicalActivityValidationErrors,
      ...workValidationErrors,
      ...otherActivityValidationErrors
    ][0]
    if (firstError === undefined) return
    const sectionState = getSectionStateForError(firstError.fieldId)
    const sectionSnapshot = {
      alcoholExpanded,
      baselineOpen,
      tobaccoExpanded,
      tobaccoBaselineOpen,
      physicalActivityExpanded,
      workExpanded,
      workBaselineOpen,
      otherActivityExpanded
    }
    if (sectionState !== null && !isSectionStateApplied(sectionSnapshot, sectionState)) {
      onUpdate((current) =>
        current.validationFocusRequestToken === validationFocusRequestToken
          ? { ...current, ...sectionState }
          : current
      )
      return
    }
    consumedValidationFocusTokens.current.add(validationFocusRequestToken)
    const focusId =
      {
        baselineEverConsumed: 'alcohol-baseline-ever-YES',
        baselineConsumedPast12Months: 'alcohol-baseline-past-year-YES',
        baselineOtherBeverageDescription: 'alcohol-baseline-other',
        baselineCommonBeverageTypes: 'alcohol-baseline-beverage-BEER',
        drinkingDays: 'alcohol-drinking-days',
        totalStandardizedDrinks: 'alcohol-total-drinks',
        largestOneDayAmount: 'alcohol-largest-day',
        daysAtLargestAmount: 'alcohol-days-largest',
        weeklyOtherBeverageDescription: 'alcohol-weekly-other',
        weeklyResponse: 'alcohol-weekly-response-YES',
        'alcohol-baseline-reference': 'lifestyle-alcohol-baseline-button',
        'tobacco-baseline-reference': 'lifestyle-tobacco-baseline-button',
        'work-baseline-reference': 'lifestyle-work-baseline-button',
        'tobacco-baseline-review-confirmation': 'tobacco-baseline-review-confirmation',
        'alcohol-baseline-review-confirmation': 'alcohol-baseline-review-confirmation',
        'tobacco-weekly-response': 'tobacco-weekly-response-YES',
        'tobacco-baseline-ever-used': 'tobacco-baseline-ever-YES',
        'tobacco-baseline-frequency': 'tobacco-baseline-frequency-EVERY_DAY',
        'tobacco-baseline-product-types': 'tobacco-baseline-product-CIGARETTE',
        'physical-weekly-response': 'physical-weekly-response-YES',
        'physical-sedentary-response': 'physical-sedentary-response-RECORDED',
        'work-weekly-response': 'work-weekly-USUAL',
        'other-weekly-response': 'other-weekly-response-YES'
      }[firstError.fieldId] ?? firstError.fieldId
    queueMicrotask(() => {
      const target = document.getElementById(focusId)
      if (target instanceof HTMLElement) {
        target.focus()
      } else {
        document.getElementById('lifestyle-validation-summary')?.focus()
      }
      onUpdate((current) =>
        current.validationFocusRequestToken === validationFocusRequestToken
          ? { ...current, validationFocusRequestToken: null }
          : current
      )
    })
  }, [
    alcoholExpanded,
    baselineOpen,
    otherActivityExpanded,
    otherActivityValidationErrors,
    physicalActivityExpanded,
    physicalActivityValidationErrors,
    tobaccoBaselineOpen,
    tobaccoExpanded,
    tobaccoValidationErrors,
    validationErrors,
    validationFocusRequestToken,
    workBaselineOpen,
    workExpanded,
    workValidationErrors,
    onUpdate
  ])

  useEffect(() => {
    if (state.statusMessage !== 'Lifestyle saved') return
    queueMicrotask(() => {
      document.getElementById('lifestyle-save-status')?.focus()
    })
  }, [state.statusMessage])

  const confirmAlcoholBaselineReview = (confirmed: boolean): void => {
    const baseline = state.workspace ? getAlcoholBaselineForInterpretation(state.workspace) : null
    onUpdate((current) => ({
      ...current,
      alcoholBaselineReviewConfirmedVersionId: confirmed && baseline ? baseline.id : null
    }))
  }
  const confirmTobaccoBaselineReview = (confirmed: boolean): void => {
    const baseline = state.workspace ? getTobaccoBaselineForInterpretation(state.workspace) : null
    onUpdate((current) => ({
      ...current,
      tobaccoBaselineReviewConfirmedVersionId: confirmed && baseline ? baseline.id : null
    }))
  }

  return (
    <section
      className="screening-current-step lifestyle-step"
      aria-labelledby="screening-lifestyle-step-title"
    >
      <div className="screening-current-step-header">
        <div>
          <h3 id="screening-lifestyle-step-title">Lifestyle</h3>
          <p className="lifestyle-period">
            {state.workspace?.draft === null || state.workspace === null
              ? 'Weekly period will be set when the draft is saved.'
              : `Weekly period: ${state.workspace.draft.periodStart} to ${state.workspace.draft.periodEnd}`}
          </p>
        </div>
        <div className="lifestyle-module-state">
          <span>{lifestyleCompleted ? 'Read only' : formatEncounterStatus(encounterStatus)}</span>
          {canReopen ? (
            <button
              className="button button-secondary lifestyle-inline-button"
              type="button"
              onClick={onReopen}
            >
              Edit Lifestyle
            </button>
          ) : null}
        </div>
      </div>

      {state.loadStatus === 'LOADING' || state.loadStatus === 'NOT_LOADED' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="status"
          aria-live="polite"
        >
          Loading Lifestyle.
        </div>
      ) : state.loadStatus === 'ERROR' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="alert"
          aria-live="assertive"
        >
          <p>{state.statusMessage ?? 'Lifestyle could not be loaded.'}</p>
          <button className="button button-secondary" type="button" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="lifestyle-card-grid" aria-label="Lifestyle sections">
            <AlcoholCard
              state={state}
              encounterStatus={encounterStatus}
              readOnly={lifestyleCompleted}
              onUpdateBaseline={(update) => {
                onUpdate((current) => updateBaselineForm(current, update))
              }}
              onUpdateAlcohol={(update) => {
                onUpdate((current) => updateAlcoholForm(current, update))
              }}
              onToggleBaseline={() => {
                onUpdate((current) => ({ ...current, baselineOpen: !current.baselineOpen }))
              }}
              onToggleExpanded={() => {
                onUpdate((current) => toggleLifestyleCard(current, 'ALCOHOL'))
              }}
              onSaveBaseline={onSaveBaseline}
              onConfirmBaselineReview={confirmAlcoholBaselineReview}
            />
            <TobaccoCard
              state={state}
              encounterStatus={encounterStatus}
              readOnly={lifestyleCompleted}
              onUpdateBaseline={(update) =>
                onUpdate((current) => updateTobaccoBaselineForm(current, update))
              }
              onUpdateTobacco={(update) =>
                onUpdate((current) => updateTobaccoForm(current, update))
              }
              onToggleBaseline={() =>
                onUpdate((current) => ({
                  ...current,
                  tobaccoBaselineOpen: !current.tobaccoBaselineOpen
                }))
              }
              onToggleExpanded={() =>
                onUpdate((current) => toggleLifestyleCard(current, 'TOBACCO'))
              }
              onSaveBaseline={onSaveTobaccoBaseline}
              onConfirmBaselineReview={confirmTobaccoBaselineReview}
            />
            <PhysicalActivityCard
              form={state.physicalActivity}
              errors={state.physicalActivityValidationErrors}
              expanded={state.physicalActivityExpanded}
              encounterStatus={encounterStatus}
              readOnly={lifestyleCompleted}
              saving={state.saveStatus === 'SAVING'}
              onUpdate={(update) =>
                onUpdate((current) => updatePhysicalActivityForm(current, update))
              }
              onToggleExpanded={() =>
                onUpdate((current) => toggleLifestyleCard(current, 'PHYSICAL_ACTIVITY'))
              }
            />
            <WorkCard
              state={state}
              encounterStatus={encounterStatus}
              readOnly={lifestyleCompleted}
              onUpdateBaseline={(update) =>
                onUpdate((current) => updateWorkBaselineForm(current, update))
              }
              onUpdateWork={(update) => onUpdate((current) => updateWorkForm(current, update))}
              onToggleBaseline={() =>
                onUpdate((current) => ({ ...current, workBaselineOpen: !current.workBaselineOpen }))
              }
              onToggleExpanded={() => onUpdate((current) => toggleLifestyleCard(current, 'WORK'))}
              onSaveBaseline={onSaveWorkBaseline}
            />
            <OtherActivityCard
              form={state.otherActivity}
              errors={state.otherActivityValidationErrors}
              expanded={state.otherActivityExpanded}
              encounterStatus={encounterStatus}
              readOnly={lifestyleCompleted}
              saving={state.saveStatus === 'SAVING'}
              onUpdate={(update) => onUpdate((current) => updateOtherActivityForm(current, update))}
              onToggleExpanded={() =>
                onUpdate((current) => toggleLifestyleCard(current, 'OTHER_ACTIVITY'))
              }
            />
          </div>

          {state.statusMessage !== null && state.saveStatus !== 'ERROR' ? (
            <div
              id={state.statusMessage === 'Lifestyle saved' ? 'lifestyle-save-status' : undefined}
              className="lifestyle-step-status"
              role="status"
              aria-live="polite"
              tabIndex={state.statusMessage === 'Lifestyle saved' ? -1 : undefined}
            >
              {state.statusMessage}
            </div>
          ) : null}
          {state.saveStatus === 'ERROR' ? (
            <div
              id="lifestyle-validation-summary"
              className="lifestyle-step-status"
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
            >
              {state.statusMessage ?? 'Check the highlighted Lifestyle fields.'}
            </div>
          ) : null}
          {cardStatus === 'BASELINE_REVIEW' ? (
            <div className="lifestyle-review-notice" role="status" aria-live="polite">
              Review baseline before completing this section.
            </div>
          ) : null}
          {state.saveStatus === 'ERROR' && state.statusMessage?.includes('changed elsewhere') ? (
            <div className="lifestyle-conflict" role="alert" aria-live="assertive">
              <span>{state.statusMessage}</span>
              <button className="button button-secondary" type="button" onClick={onReload}>
                Reload
              </button>
            </div>
          ) : null}
        </>
      )}

      <div className="screening-encounter-actions">
        <button className="button button-secondary" type="button" onClick={onBackToVitals}>
          Previous
        </button>
        <div className="lifestyle-action-group">
          <button
            className="button button-secondary"
            type="button"
            disabled={!canSave || lifestyleCompleted}
            onClick={onSaveDraft}
          >
            {state.saveStatus === 'SAVING' ? 'Saving draft...' : 'Save draft'}
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={
              state.loadStatus !== 'READY' ||
              encounterStatus !== 'DRAFT' ||
              state.saveStatus === 'SAVING'
            }
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}

function updateBaselineForm(
  state: LifestyleDraftState,
  update: (form: AlcoholBaselineForm) => AlcoholBaselineForm
): LifestyleDraftState {
  const baselineForm = update(state.baselineForm)
  return {
    ...state,
    baselineForm,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: validateAlcoholBaseline(baselineForm)
  }
}

function updateAlcoholForm(
  state: LifestyleDraftState,
  update: (form: AlcoholWeeklyForm) => AlcoholWeeklyForm
): LifestyleDraftState {
  const alcohol = update(state.alcohol)
  return {
    ...state,
    alcohol,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    validationErrors: validateAlcoholWeeklyDraft(alcohol)
  }
}

function updateTobaccoBaselineForm(
  state: LifestyleDraftState,
  update: (form: TobaccoBaselineForm) => TobaccoBaselineForm
): LifestyleDraftState {
  const tobaccoBaselineForm = update(state.tobaccoBaselineForm)
  return {
    ...state,
    tobaccoBaselineForm,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    tobaccoValidationErrors: validateTobaccoBaseline(tobaccoBaselineForm)
  }
}

function updateTobaccoForm(
  state: LifestyleDraftState,
  update: (form: TobaccoWeeklyForm) => TobaccoWeeklyForm
): LifestyleDraftState {
  const tobacco = update(state.tobacco)
  return {
    ...state,
    tobacco,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    tobaccoValidationErrors: validateTobaccoWeeklyDraft(tobacco)
  }
}

function updatePhysicalActivityForm(
  state: LifestyleDraftState,
  update: (form: PhysicalActivityForm) => PhysicalActivityForm
): LifestyleDraftState {
  const physicalActivity = update(state.physicalActivity)
  return {
    ...state,
    physicalActivity,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    physicalActivityValidationErrors: validatePhysicalActivity(physicalActivity)
  }
}

function updateWorkBaselineForm(
  state: LifestyleDraftState,
  update: (form: WorkBaselineForm) => WorkBaselineForm
): LifestyleDraftState {
  const workBaselineForm = update(state.workBaselineForm)
  return {
    ...state,
    workBaselineForm,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    workValidationErrors: validateWorkBaseline(workBaselineForm)
  }
}

function updateWorkForm(
  state: LifestyleDraftState,
  update: (form: WorkWeeklyForm) => WorkWeeklyForm
): LifestyleDraftState {
  return {
    ...state,
    work: update(state.work),
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null
  }
}

function updateOtherActivityForm(
  state: LifestyleDraftState,
  update: (form: OtherActivityForm) => OtherActivityForm
): LifestyleDraftState {
  const otherActivity = update(state.otherActivity)
  return {
    ...state,
    otherActivity,
    dirty: true,
    saveStatus: 'IDLE',
    statusMessage: null,
    otherActivityValidationErrors: validateOtherActivity(otherActivity)
  }
}

function formatEncounterStatus(status: PublicScreeningEncounterStartSummary['status']): string {
  return status === 'DRAFT' ? 'Editable' : 'Read only'
}

type LifestyleSectionState = Pick<
  LifestyleDraftState,
  | 'alcoholExpanded'
  | 'baselineOpen'
  | 'tobaccoExpanded'
  | 'tobaccoBaselineOpen'
  | 'physicalActivityExpanded'
  | 'workExpanded'
  | 'workBaselineOpen'
  | 'otherActivityExpanded'
>

function getSectionStateForError(fieldId: string): Partial<LifestyleSectionState> | null {
  const closed = {
    alcoholExpanded: false,
    baselineOpen: false,
    tobaccoExpanded: false,
    tobaccoBaselineOpen: false,
    physicalActivityExpanded: false,
    workExpanded: false,
    workBaselineOpen: false,
    otherActivityExpanded: false
  }
  if (
    fieldId.startsWith('baseline') ||
    fieldId.startsWith('drinking') ||
    fieldId.startsWith('totalStandardized') ||
    fieldId.startsWith('largest') ||
    fieldId.startsWith('daysAt') ||
    fieldId.startsWith('weeklyOther') ||
    fieldId === 'alcoholBaselineReviewConfirmation' ||
    fieldId === 'alcohol-baseline-review-confirmation' ||
    fieldId === 'alcohol-baseline-reference'
  ) {
    return {
      ...closed,
      alcoholExpanded: true,
      baselineOpen: fieldId.startsWith('baseline')
    }
  }
  if (fieldId.startsWith('tobacco-') || fieldId === 'tobacco-baseline-reference') {
    return {
      ...closed,
      tobaccoExpanded: true,
      tobaccoBaselineOpen:
        fieldId.startsWith('tobacco-baseline') ||
        fieldId === 'tobaccoBaselineReviewConfirmation' ||
        fieldId === 'tobacco-baseline-review-confirmation' ||
        fieldId === 'tobacco-baseline-reference'
    }
  }
  if (fieldId.startsWith('physical-')) return { ...closed, physicalActivityExpanded: true }
  if (fieldId.startsWith('work-baseline')) {
    return { ...closed, workExpanded: true, workBaselineOpen: true }
  }
  if (fieldId.startsWith('work-')) return { ...closed, workExpanded: true }
  if (fieldId.startsWith('other-')) return { ...closed, otherActivityExpanded: true }
  return null
}

function isSectionStateApplied(
  state: LifestyleSectionState,
  next: Partial<LifestyleSectionState>
): boolean {
  return Object.entries(next).every(
    ([key, value]) => state[key as keyof LifestyleSectionState] === value
  )
}
