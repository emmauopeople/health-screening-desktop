import { useState } from 'react'

import type { PublicScreeningEncounterStartSummary } from '@shared/ipc'

import {
  alcoholBeverageOptions,
  alcoholWeeklyOptions,
  getAlcoholCardStatus,
  getAlcoholCardSummary,
  getAlcoholBaselineForInterpretation,
  hasBaselineReviewConflict,
  type AlcoholBaselineForm,
  type AlcoholFieldError,
  type AlcoholWeeklyForm,
  type LifestyleDraftState
} from './lifestyle-workspace-model'

interface AlcoholCardProps {
  readonly state: LifestyleDraftState
  readonly encounterStatus: PublicScreeningEncounterStartSummary['status']
  readonly readOnly?: boolean
  onUpdateBaseline(update: (form: AlcoholBaselineForm) => AlcoholBaselineForm): void
  onUpdateAlcohol(update: (form: AlcoholWeeklyForm) => AlcoholWeeklyForm): void
  onToggleBaseline(): void
  onToggleExpanded(): void
  onSaveBaseline(): void
  onConfirmBaselineReview(confirmed: boolean): void
}

export function AlcoholCard({
  state,
  encounterStatus,
  readOnly = false,
  onUpdateBaseline,
  onUpdateAlcohol,
  onToggleBaseline,
  onToggleExpanded,
  onSaveBaseline,
  onConfirmBaselineReview
}: AlcoholCardProps): React.JSX.Element {
  const [drinkGuidanceOpen, setDrinkGuidanceOpen] = useState(false)
  const editable = encounterStatus === 'DRAFT' && !readOnly
  const controlsDisabled = !editable || state.saveStatus === 'SAVING'
  const status = getAlcoholCardStatus(state, editable)
  const summary = getAlcoholCardSummary(state, editable)
  const baseline =
    state.workspace === null ? null : getAlcoholBaselineForInterpretation(state.workspace)
  const hasBaseline = baseline !== null && baseline !== undefined
  const showBaselineReviewConfirmation = hasBaselineReviewConflict(
    baseline?.status,
    state.alcohol.weeklyResponse
  )
  const baselineErrors = (fieldId: string): AlcoholFieldError | undefined =>
    state.validationErrors.find((error) => error.fieldId === fieldId)
  const weeklyErrors = (fieldId: string): AlcoholFieldError | undefined =>
    state.validationErrors.find((error) => error.fieldId === fieldId)
  const statusLabel = formatAlcoholStatus(status, editable)
  const statusClass = status === 'COMPLETE' && editable ? 'ready' : status.toLowerCase()

  return (
    <section
      className={`lifestyle-card lifestyle-card-alcohol lifestyle-card-status-${statusClass}`}
      aria-labelledby="lifestyle-alcohol-title"
    >
      <button
        className="lifestyle-card-header"
        type="button"
        aria-expanded={state.alcoholExpanded}
        aria-controls="lifestyle-alcohol-content"
        disabled={state.saveStatus === 'SAVING'}
        onClick={onToggleExpanded}
      >
        <span>
          <span className="lifestyle-card-kicker">1</span>
          <strong id="lifestyle-alcohol-title">Alcohol</strong>
        </span>
        <span className="lifestyle-card-status" aria-label={`Alcohol status: ${statusLabel}`}>
          <span aria-hidden="true" className="lifestyle-status-mark" />
          {statusLabel}
        </span>
      </button>

      <p className="lifestyle-card-summary">{summary}</p>

      {state.alcoholExpanded ? (
        <div id="lifestyle-alcohol-content" className="lifestyle-card-content">
          <button
            className="button button-secondary lifestyle-inline-button"
            id="lifestyle-alcohol-baseline-button"
            type="button"
            aria-expanded={state.baselineOpen}
            aria-controls="lifestyle-alcohol-baseline-panel"
            disabled={state.saveStatus === 'SAVING'}
            onClick={onToggleBaseline}
          >
            Alcohol Baseline
          </button>

          {state.baselineOpen ? (
            <section
              id="lifestyle-alcohol-baseline-panel"
              className="lifestyle-inline-panel"
              aria-labelledby="lifestyle-alcohol-baseline-title"
            >
              <h4 id="lifestyle-alcohol-baseline-title">Alcohol Baseline</h4>
              <fieldset
                id="alcohol-baseline-ever-consumed"
                aria-invalid={baselineErrors('baselineEverConsumed') !== undefined}
                aria-describedby={
                  baselineErrors('baselineEverConsumed') === undefined
                    ? undefined
                    : errorElementId('baselineEverConsumed')
                }
              >
                <legend>Ever consumed alcohol?</legend>
                {(['YES', 'NO', 'UNKNOWN', 'DECLINED'] as const).map((value) => (
                  <label className="lifestyle-choice" key={value}>
                    <input
                      id={`alcohol-baseline-ever-${value}`}
                      type="radio"
                      name="alcohol-ever-consumed"
                      value={value}
                      checked={state.baselineForm.everConsumed === value}
                      disabled={controlsDisabled}
                      onChange={() => {
                        onUpdateBaseline((form) => ({
                          ...form,
                          everConsumed: value,
                          consumedPast12Months:
                            value === 'NO' || value === 'DECLINED' ? '' : form.consumedPast12Months,
                          commonBeverageTypes:
                            value === 'NO' || value === 'DECLINED' ? [] : form.commonBeverageTypes,
                          otherBeverageDescription:
                            value === 'NO' || value === 'DECLINED'
                              ? ''
                              : form.otherBeverageDescription
                        }))
                      }}
                    />
                    {formatResponse(value)}
                  </label>
                ))}
              </fieldset>

              {state.baselineForm.everConsumed === 'YES' ||
              state.baselineForm.everConsumed === 'UNKNOWN' ? (
                <fieldset
                  id="alcohol-baseline-past-year"
                  aria-invalid={baselineErrors('baselineConsumedPast12Months') !== undefined}
                  aria-describedby={
                    baselineErrors('baselineConsumedPast12Months') === undefined
                      ? undefined
                      : errorElementId('baselineConsumedPast12Months')
                  }
                >
                  <legend>Consumed alcohol in the past 12 months?</legend>
                  {(['YES', 'NO', 'UNKNOWN', 'DECLINED'] as const).map((value) => (
                    <label className="lifestyle-choice" key={value}>
                      <input
                        id={`alcohol-baseline-past-year-${value}`}
                        type="radio"
                        name="alcohol-past-year"
                        value={value}
                        checked={state.baselineForm.consumedPast12Months === value}
                        disabled={controlsDisabled}
                        onChange={() => {
                          onUpdateBaseline((form) => ({ ...form, consumedPast12Months: value }))
                        }}
                      />
                      {formatResponse(value)}
                    </label>
                  ))}
                </fieldset>
              ) : null}

              {isBeverageSectionApplicable(state.baselineForm) ? (
                <fieldset
                  id="alcohol-baseline-beverage-types"
                  tabIndex={-1}
                  aria-invalid={baselineErrors('baselineCommonBeverageTypes') !== undefined}
                  aria-describedby={
                    baselineErrors('baselineCommonBeverageTypes') === undefined
                      ? undefined
                      : errorElementId('baselineCommonBeverageTypes')
                  }
                >
                  <legend>Common beverage types</legend>
                  <div className="lifestyle-choice-grid">
                    {alcoholBeverageOptions.map((option) => (
                      <label className="lifestyle-choice" key={option.value}>
                        <input
                          id={`alcohol-baseline-beverage-${option.value}`}
                          type="checkbox"
                          value={option.value}
                          checked={state.baselineForm.commonBeverageTypes.includes(option.value)}
                          disabled={controlsDisabled}
                          onChange={() => {
                            onUpdateBaseline((form) => ({
                              ...form,
                              commonBeverageTypes: form.commonBeverageTypes.includes(option.value)
                                ? form.commonBeverageTypes.filter((item) => item !== option.value)
                                : [...form.commonBeverageTypes, option.value]
                            }))
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {state.baselineForm.commonBeverageTypes.includes('OTHER') ? (
                <Field
                  id="alcohol-baseline-other"
                  label="Other beverage"
                  value={state.baselineForm.otherBeverageDescription}
                  error={baselineErrors('baselineOtherBeverageDescription')}
                  disabled={controlsDisabled}
                  onChange={(value) => {
                    onUpdateBaseline((form) => ({ ...form, otherBeverageDescription: value }))
                  }}
                />
              ) : null}

              {baselineErrors('baselineEverConsumed') ||
              baselineErrors('baselineConsumedPast12Months') ||
              baselineErrors('baselineCommonBeverageTypes') ? (
                <ValidationList
                  errors={state.validationErrors}
                  ids={[
                    'baselineEverConsumed',
                    'baselineConsumedPast12Months',
                    'baselineCommonBeverageTypes'
                  ]}
                />
              ) : null}
              <div className="lifestyle-inline-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={onToggleBaseline}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={controlsDisabled}
                  onClick={onSaveBaseline}
                >
                  {state.saveStatus === 'SAVING' ? 'Saving...' : 'Save baseline'}
                </button>
              </div>
            </section>
          ) : null}

          {hasBaseline ? (
            <section
              className="lifestyle-weekly-panel"
              aria-labelledby="lifestyle-alcohol-weekly-title"
            >
              <h4 id="lifestyle-alcohol-weekly-title">Weekly alcohol</h4>
              {showBaselineReviewConfirmation && baseline ? (
                <label className="lifestyle-choice" htmlFor="alcohol-baseline-review-confirmation">
                  <input
                    id="alcohol-baseline-review-confirmation"
                    type="checkbox"
                    checked={state.alcoholBaselineReviewConfirmedVersionId === baseline.id}
                    disabled={controlsDisabled}
                    onChange={(event) => onConfirmBaselineReview(event.target.checked)}
                  />
                  I have reviewed this baseline
                </label>
              ) : null}
              <fieldset>
                <legend>Did you consume alcohol during the past 7 days?</legend>
                {alcoholWeeklyOptions.map((option) => (
                  <label className="lifestyle-choice" key={option.value}>
                    <input
                      id={`alcohol-weekly-response-${option.value}`}
                      type="radio"
                      name="alcohol-weekly-response"
                      value={option.value}
                      checked={state.alcohol.weeklyResponse === option.value}
                      disabled={controlsDisabled}
                      onChange={() => {
                        onUpdateAlcohol((form) => updateWeeklyResponse(form, option.value))
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>

              {state.alcohol.weeklyResponse === 'YES' ? (
                <div className="lifestyle-form-grid">
                  <Field
                    id="alcohol-drinking-days"
                    label="On how many of the past 7 days did you drink alcohol?"
                    type="number"
                    min="1"
                    max="7"
                    value={state.alcohol.drinkingDays}
                    error={weeklyErrors('drinkingDays')}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      onUpdateAlcohol((form) => ({ ...form, drinkingDays: value }))
                    }
                  />
                  <Field
                    id="alcohol-total-drinks"
                    label="How many drinks did you have in total during the past 7 days?"
                    type="number"
                    min="0"
                    step="any"
                    value={state.alcohol.totalStandardizedDrinks}
                    error={weeklyErrors('totalStandardizedDrinks')}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      onUpdateAlcohol((form) => ({ ...form, totalStandardizedDrinks: value }))
                    }
                  />
                  <div className="lifestyle-drink-guidance">
                    <button
                      className="lifestyle-disclosure-button"
                      type="button"
                      aria-expanded={drinkGuidanceOpen}
                      aria-controls="alcohol-drink-guidance"
                      onClick={() => setDrinkGuidanceOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setDrinkGuidanceOpen((open) => !open)
                        }
                      }}
                    >
                      What counts as one drink?
                    </button>
                    {drinkGuidanceOpen ? (
                      <div
                        id="alcohol-drink-guidance"
                        className="lifestyle-disclosure"
                        role="region"
                        aria-label="What counts as one drink?"
                      >
                        <p>
                          For this screening, one drink contains about 10 grams of pure alcohol.
                        </p>
                        <ul>
                          <li>250 mL regular beer at 5%</li>
                          <li>100 mL wine at 12%</li>
                          <li>30 mL spirits at 40%</li>
                        </ul>
                        <p>Larger or stronger servings may count as more than one drink.</p>
                      </div>
                    ) : null}
                  </div>
                  <Field
                    id="alcohol-largest-day"
                    label="What was the highest number of drinks you had on any one day?"
                    type="number"
                    min="0"
                    step="any"
                    value={state.alcohol.largestOneDayAmount}
                    error={weeklyErrors('largestOneDayAmount')}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      onUpdateAlcohol((form) => ({ ...form, largestOneDayAmount: value }))
                    }
                  />
                  <Field
                    id="alcohol-days-largest"
                    label="On how many days did you have that highest number?"
                    type="number"
                    min="1"
                    max="7"
                    value={state.alcohol.daysAtLargestAmount}
                    error={weeklyErrors('daysAtLargestAmount')}
                    disabled={controlsDisabled}
                    onChange={(value) =>
                      onUpdateAlcohol((form) => ({ ...form, daysAtLargestAmount: value }))
                    }
                  />
                </div>
              ) : null}

              {state.alcohol.weeklyResponse === 'YES' ? (
                <>
                  <fieldset>
                    <legend>What types of alcoholic drinks did you have?</legend>
                    <div className="lifestyle-choice-grid">
                      {alcoholBeverageOptions.map((option) => (
                        <label className="lifestyle-choice" key={option.value}>
                          <input
                            type="checkbox"
                            value={option.value}
                            checked={state.alcohol.commonBeverageTypes.includes(option.value)}
                            disabled={controlsDisabled}
                            onChange={() => {
                              onUpdateAlcohol((form) => ({
                                ...form,
                                commonBeverageTypes: form.commonBeverageTypes.includes(option.value)
                                  ? form.commonBeverageTypes.filter((item) => item !== option.value)
                                  : [...form.commonBeverageTypes, option.value]
                              }))
                            }}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {state.alcohol.commonBeverageTypes.includes('OTHER') ? (
                    <Field
                      id="alcohol-weekly-other"
                      label="Other beverage"
                      value={state.alcohol.otherBeverageDescription}
                      error={weeklyErrors('weeklyOtherBeverageDescription')}
                      disabled={controlsDisabled}
                      onChange={(value) =>
                        onUpdateAlcohol((form) => ({ ...form, otherBeverageDescription: value }))
                      }
                    />
                  ) : null}
                </>
              ) : null}

              {state.validationErrors.length > 0 ? (
                <ValidationList errors={state.validationErrors} />
              ) : null}
              {state.statusMessage !== null ? (
                <div
                  className="lifestyle-inline-status"
                  role={state.saveStatus === 'ERROR' ? 'alert' : 'status'}
                >
                  {state.statusMessage}
                </div>
              ) : null}
            </section>
          ) : (
            <p className="lifestyle-card-muted">Baseline required.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Field({
  id,
  label,
  value,
  type = 'text',
  min,
  max,
  step,
  error,
  disabled,
  onChange
}: {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly type?: 'text' | 'number'
  readonly min?: string
  readonly max?: string
  readonly step?: string
  readonly error?: AlcoholFieldError
  readonly disabled: boolean
  onChange(value: string): void
}): React.JSX.Element {
  const errorId = `${id}-error`
  return (
    <label className="lifestyle-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        aria-label={label}
        type={type}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error !== undefined ? (
        <span id={errorId} className="lifestyle-field-error">
          {error.message}
        </span>
      ) : null}
    </label>
  )
}

function errorElementId(fieldId: string): string {
  return `lifestyle-error-${fieldId}`
}

function ValidationList({
  errors,
  ids
}: {
  readonly errors: readonly AlcoholFieldError[]
  readonly ids?: readonly string[]
}): React.JSX.Element | null {
  const visible = ids === undefined ? errors : errors.filter((error) => ids.includes(error.fieldId))
  if (visible.length === 0) return null
  return (
    <div className="lifestyle-validation" role="alert" aria-live="assertive">
      <ul>
        {visible.map((error) => (
          <li id={errorElementId(error.fieldId)} key={`${error.fieldId}:${error.message}`}>
            {error.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

function updateWeeklyResponse(
  form: AlcoholWeeklyForm,
  response: AlcoholWeeklyForm['weeklyResponse']
): AlcoholWeeklyForm {
  if (response === 'YES' || response === '') return { ...form, weeklyResponse: response }
  return {
    ...form,
    weeklyResponse: response,
    drinkingDays: '',
    totalStandardizedDrinks: '',
    largestOneDayAmount: '',
    daysAtLargestAmount: '',
    commonBeverageTypes: [],
    otherBeverageDescription: ''
  }
}

function isBeverageSectionApplicable(form: AlcoholBaselineForm): boolean {
  return (
    form.everConsumed === 'YES' ||
    form.everConsumed === 'UNKNOWN' ||
    form.consumedPast12Months === 'YES'
  )
}

function formatResponse(value: string): string {
  return value === 'PREFER_NOT_TO_ANSWER'
    ? 'Prefer not to answer'
    : value.charAt(0) + value.slice(1).toLowerCase()
}

function formatAlcoholStatus(
  status: ReturnType<typeof getAlcoholCardStatus>,
  editable: boolean
): string {
  if (status === 'COMPLETE' && editable) return 'Ready'
  return {
    NOT_STARTED: 'Not started',
    IN_PROGRESS: 'In progress',
    COMPLETE: 'Complete',
    BASELINE_REVIEW: 'Baseline review required',
    VALIDATION_ERROR: 'Validation error',
    LOCKED: 'Locked'
  }[status]
}
