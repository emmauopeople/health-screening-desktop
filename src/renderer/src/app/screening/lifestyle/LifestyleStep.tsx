import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'
import { useEffect } from 'react'

import { AlcoholCard } from './AlcoholCard'
import { TobaccoCard } from './TobaccoCard'
import {
  getAlcoholCardStatus,
  toggleLifestyleCard,
  validateAlcoholBaseline,
  validateAlcoholWeeklyDraft,
  type AlcoholBaselineForm,
  type AlcoholWeeklyForm,
  type LifestyleDraftState
} from './lifestyle-workspace-model'
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
  onSaveDraft(): void
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
  onSaveDraft
}: LifestyleStepProps): React.JSX.Element {
  const editable = encounterStatus === 'DRAFT'
  const controlsDisabled = !editable || state.saveStatus === 'SAVING'
  const cardStatus = getAlcoholCardStatus(state, editable)
  const canSave = state.loadStatus === 'READY' && !controlsDisabled

  useEffect(() => {
    const firstError = state.validationErrors[0]
    if (firstError === undefined) return
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
        weeklyOtherBeverageDescription: 'alcohol-weekly-other'
      }[firstError.fieldId] ?? firstError.fieldId
    document.getElementById(focusId)?.focus()
  }, [state.validationErrors])

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
        <span>{formatEncounterStatus(encounterStatus)}</span>
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
            />
            <TobaccoCard
              state={state}
              encounterStatus={encounterStatus}
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
            />
            <DisabledLifestyleCard number="3" title="Physical activity" />
            <DisabledLifestyleCard number="4" title="Work and occupation" />
            <DisabledLifestyleCard number="5" title="Other activity" />
          </div>

          {state.statusMessage !== null && state.saveStatus !== 'ERROR' ? (
            <div className="lifestyle-step-status" role="status" aria-live="polite">
              {state.statusMessage}
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
            disabled={!canSave}
            onClick={onSaveDraft}
          >
            {state.saveStatus === 'SAVING' ? 'Saving draft...' : 'Save draft'}
          </button>
          <button className="button button-primary" type="button" disabled>
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}

function DisabledLifestyleCard({
  number,
  title
}: {
  readonly number: string
  readonly title: string
}): React.JSX.Element {
  return (
    <section
      className="lifestyle-card lifestyle-card-disabled"
      aria-labelledby={`lifestyle-card-${number}`}
    >
      <div className="lifestyle-card-header lifestyle-card-header-static">
        <span>
          <span className="lifestyle-card-kicker">{number}</span>
          <strong id={`lifestyle-card-${number}`}>{title}</strong>
        </span>
        <span className="lifestyle-card-status">Not started</span>
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

function formatEncounterStatus(status: PublicScreeningEncounterStartSummary['status']): string {
  return status === 'DRAFT' ? 'Editable' : 'Read only'
}
