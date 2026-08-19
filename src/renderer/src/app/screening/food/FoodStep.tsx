import { useEffect, useMemo, useRef } from 'react'

import type { ScreeningFoodCatalogItem, ScreeningFoodRecentSuggestion } from '@shared/ipc'

import {
  addFoodRow,
  applyFoodCatalogSelection,
  applyFoodRecentSelection,
  foodFrequencyOptions,
  foodResponseOptions,
  getFoodControlId,
  getFoodDescribedBy,
  getFoodErrorId,
  getFoodFieldError,
  moveFoodRow,
  normalizeFoodName,
  parseFoodFrequencyDraft,
  removeFoodRow,
  updateFoodResponse,
  updateFoodRow,
  type FoodDraftRowState,
  type FoodDraftState,
  type FoodResponseDraft
} from './food-workspace-model'

export interface FoodStepProps {
  readonly encounterId: string
  readonly state: FoodDraftState
  onBackToLifestyle(): void
  onRetryLoad(): void
  onReload(): void
  onSaveDraft(): void
  onUpdate(update: (state: FoodDraftState) => FoodDraftState): void
}

export function FoodStep({
  state,
  onBackToLifestyle,
  onRetryLoad,
  onReload,
  onSaveDraft,
  onUpdate
}: FoodStepProps): React.JSX.Element {
  const controlsDisabled = state.loadStatus !== 'READY' || state.saveStatus === 'SAVING'
  const canSave = state.loadStatus === 'READY' && state.saveStatus !== 'SAVING'
  const consumedValidationFocusTokens = useRef<Set<string>>(new Set())
  const responseError = getFoodFieldError(state.validationErrors, 'food-response')

  useEffect(() => {
    const token = state.validationFocusRequestToken
    if (token === null || consumedValidationFocusTokens.current.has(token)) return
    consumedValidationFocusTokens.current.add(token)
    const firstError = state.validationErrors[0]
    queueMicrotask(() => {
      const target =
        firstError === undefined
          ? null
          : document.getElementById(getFoodControlId(firstError.fieldId))
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true })
      } else {
        document.getElementById('food-validation-summary')?.focus({ preventScroll: true })
      }
      onUpdate((current) =>
        current.validationFocusRequestToken === token
          ? { ...current, validationFocusRequestToken: null }
          : current
      )
    })
  }, [onUpdate, state.validationErrors, state.validationFocusRequestToken])

  return (
    <section
      className="screening-current-step food-step"
      aria-labelledby="screening-food-step-title"
    >
      <div className="screening-current-step-header">
        <div>
          <h3 id="screening-food-step-title">Food</h3>
          <p className="food-period">
            {state.workspace?.draft === null || state.workspace === null
              ? 'Weekly period will be set when the draft is saved.'
              : `Weekly period: ${state.workspace.draft.periodStart} to ${state.workspace.draft.periodEnd}`}
          </p>
        </div>
        <span>Editable</span>
      </div>

      {state.loadStatus === 'LOADING' || state.loadStatus === 'NOT_LOADED' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="status"
          aria-live="polite"
        >
          Loading Food.
        </div>
      ) : state.loadStatus === 'ERROR' ? (
        <div
          className="screening-empty-state screening-compact-empty"
          role="alert"
          aria-live="assertive"
        >
          <p>{state.statusMessage ?? 'Food could not be loaded.'}</p>
          <button className="button button-secondary" type="button" onClick={onRetryLoad}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <fieldset
            className="food-response-panel"
            aria-describedby={responseError ? getFoodErrorId('food-response') : undefined}
          >
            <legend>Were foods eaten during the past 7 days reported?</legend>
            <div className="food-response-grid">
              <label className="food-choice">
                <input
                  id={getFoodControlId('food-response')}
                  type="radio"
                  name="food-response"
                  value=""
                  checked={state.foodResponse === ''}
                  disabled={controlsDisabled}
                  aria-invalid={responseError !== undefined}
                  onChange={() => onUpdate((current) => updateFoodResponse(current, ''))}
                />
                Unfinished draft
              </label>
              {foodResponseOptions.map((option) => (
                <label className="food-choice" key={option.value}>
                  <input
                    type="radio"
                    name="food-response"
                    value={option.value}
                    checked={state.foodResponse === option.value}
                    disabled={controlsDisabled}
                    aria-invalid={responseError !== undefined}
                    onChange={() =>
                      onUpdate((current) =>
                        updateFoodResponse(current, option.value as FoodResponseDraft)
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <p
              id={getFoodErrorId('food-response')}
              className={`food-field-error${responseError ? ' food-field-error-visible' : ''}`}
            >
              {responseError?.message ?? 'No response error.'}
            </p>
          </fieldset>

          {state.foodResponse === 'REPORTED' ? (
            <div className="food-rows-panel">
              <div className="food-rows-header">
                <h4>Foods reported</h4>
                <button
                  id="food-add-button"
                  className="button button-secondary food-add-button"
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => {
                    onUpdate(addFoodRow)
                    queueMicrotask(() => {
                      const rows = document.querySelectorAll<HTMLInputElement>('.food-name-input')
                      rows.item(rows.length - 1)?.focus()
                    })
                  }}
                >
                  Add food
                </button>
              </div>
              {state.rows.length === 0 ? (
                <div className="screening-empty-state screening-compact-empty">
                  No foods added yet.
                </div>
              ) : (
                <div className="food-row-list" aria-label="Reported foods">
                  {state.rows.map((row, index) => (
                    <FoodRow
                      key={row.localKey}
                      row={row}
                      index={index}
                      rowCount={state.rows.length}
                      disabled={controlsDisabled}
                      catalogItems={state.workspace?.catalogItems ?? []}
                      recentFoods={state.workspace?.recentFoods ?? []}
                      errors={state.validationErrors}
                      onUpdate={(update) =>
                        onUpdate((current) => updateFoodRow(current, row.localKey, update))
                      }
                      onRemove={() => {
                        onUpdate((current) => removeFoodRow(current, row.localKey))
                        queueMicrotask(() => {
                          const next =
                            document
                              .querySelectorAll<HTMLInputElement>('.food-name-input')
                              .item(index) ??
                            document
                              .querySelectorAll<HTMLInputElement>('.food-name-input')
                              .item(index - 1)
                          next?.focus()
                          if (next === null) document.getElementById('food-add-button')?.focus()
                        })
                      }}
                      onMove={(direction) =>
                        onUpdate((current) => moveFoodRow(current, row.localKey, direction))
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {state.statusMessage !== null && state.saveStatus !== 'ERROR' ? (
            <div className="food-step-status" role="status" aria-live="polite">
              {state.statusMessage}
            </div>
          ) : null}
          {state.saveStatus === 'ERROR' ? (
            <div
              id="food-validation-summary"
              className="food-step-status food-step-error"
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
            >
              {state.statusMessage ?? 'Check the highlighted Food fields.'}
              {state.statusMessage?.includes('changed elsewhere') ? (
                <button className="button button-secondary" type="button" onClick={onReload}>
                  Reload
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <div className="screening-encounter-actions">
        <button className="button button-secondary" type="button" onClick={onBackToLifestyle}>
          Previous
        </button>
        <div className="food-action-group">
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

function FoodRow({
  row,
  index,
  rowCount,
  disabled,
  catalogItems,
  recentFoods,
  errors,
  onMove,
  onRemove,
  onUpdate
}: {
  readonly row: FoodDraftRowState
  readonly index: number
  readonly rowCount: number
  readonly disabled: boolean
  readonly catalogItems: readonly ScreeningFoodCatalogItem[]
  readonly recentFoods: readonly ScreeningFoodRecentSuggestion[]
  readonly errors: readonly { readonly fieldId: string; readonly message: string }[]
  onMove(direction: 'UP' | 'DOWN'): void
  onRemove(): void
  onUpdate(update: (row: FoodDraftRowState) => FoodDraftRowState): void
}): React.JSX.Element {
  const foodFieldId = `${row.localKey}:foodName`
  const frequencyFieldId = `${row.localKey}:frequencyCode`
  const noteFieldId = `${row.localKey}:preparationNote`
  const foodError = getFoodFieldError(errors, foodFieldId)
  const noteError = getFoodFieldError(errors, noteFieldId)
  const suggestions = useMemo(
    () => getFoodSuggestions(row.foodName, catalogItems, recentFoods),
    [catalogItems, recentFoods, row.foodName]
  )

  return (
    <fieldset className="food-row">
      <legend>Food {index + 1}</legend>
      <label className="food-field food-field-name">
        Food
        <input
          id={getFoodControlId(foodFieldId)}
          className="food-name-input"
          type="text"
          aria-label={`Food ${index + 1} name`}
          value={row.foodName}
          disabled={disabled}
          aria-invalid={foodError !== undefined}
          aria-describedby={getFoodDescribedBy(errors, foodFieldId)}
          onChange={(event) => {
            const value = event.currentTarget.value
            onUpdate((current) => ({
              ...current,
              foodName: value,
              catalogCode: value === current.foodName ? current.catalogCode : null
            }))
          }}
        />
        <FoodSuggestionList
          suggestions={suggestions}
          disabled={disabled}
          onSelectCatalog={(item) =>
            onUpdate((current) => applyFoodCatalogSelection(current, item))
          }
          onSelectRecent={(suggestion) =>
            onUpdate((current) => applyFoodRecentSelection(current, suggestion))
          }
        />
        <p
          id={getFoodErrorId(foodFieldId)}
          className={`food-field-error${foodError ? ' food-field-error-visible' : ''}`}
        >
          {foodError?.message ?? 'No food name error.'}
        </p>
      </label>
      <label className="food-field food-field-frequency">
        Frequency
        <select
          id={getFoodControlId(frequencyFieldId)}
          aria-label={`Food ${index + 1} frequency`}
          value={row.frequencyCode}
          disabled={disabled}
          onChange={(event) => {
            const frequencyCode = parseFoodFrequencyDraft(event.currentTarget.value)
            if (frequencyCode === null) return
            onUpdate((current) => ({
              ...current,
              frequencyCode
            }))
          }}
        >
          {foodFrequencyOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="food-field-error">No frequency error.</p>
      </label>
      <label className="food-field food-field-note">
        Preparation or note (optional)
        <input
          id={getFoodControlId(noteFieldId)}
          type="text"
          aria-label={`Food ${index + 1} preparation or note`}
          value={row.preparationNote}
          disabled={disabled}
          aria-invalid={noteError !== undefined}
          aria-describedby={getFoodDescribedBy(errors, noteFieldId)}
          onChange={(event) => {
            const preparationNote = event.currentTarget.value
            onUpdate((current) => ({ ...current, preparationNote }))
          }}
        />
        <p
          id={getFoodErrorId(noteFieldId)}
          className={`food-field-error${noteError ? ' food-field-error-visible' : ''}`}
        >
          {noteError?.message ?? 'No note error.'}
        </p>
      </label>
      <div className="food-row-actions">
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onMove('UP')}
        >
          Move up
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled || index === rowCount - 1}
          onClick={() => onMove('DOWN')}
        >
          Move down
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </fieldset>
  )
}

type FoodSuggestion =
  | { readonly type: 'CATALOG'; readonly key: string; readonly item: ScreeningFoodCatalogItem }
  | {
      readonly type: 'RECENT'
      readonly key: string
      readonly suggestion: ScreeningFoodRecentSuggestion
    }

function FoodSuggestionList({
  suggestions,
  disabled,
  onSelectCatalog,
  onSelectRecent
}: {
  readonly suggestions: readonly FoodSuggestion[]
  readonly disabled: boolean
  onSelectCatalog(item: ScreeningFoodCatalogItem): void
  onSelectRecent(suggestion: ScreeningFoodRecentSuggestion): void
}): React.JSX.Element | null {
  if (suggestions.length === 0) return null
  return (
    <div className="food-suggestions" aria-label="Food suggestions">
      {suggestions.map((suggestion) =>
        suggestion.type === 'CATALOG' ? (
          <button
            className="food-suggestion"
            key={suggestion.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelectCatalog(suggestion.item)}
          >
            {suggestion.item.displayName}
          </button>
        ) : (
          <button
            className="food-suggestion"
            key={suggestion.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelectRecent(suggestion.suggestion)}
          >
            {suggestion.suggestion.foodNameSnapshot}
            <span>Recent</span>
          </button>
        )
      )}
    </div>
  )
}

function getFoodSuggestions(
  query: string,
  catalogItems: readonly ScreeningFoodCatalogItem[],
  recentFoods: readonly ScreeningFoodRecentSuggestion[]
): readonly FoodSuggestion[] {
  const normalizedQuery = normalizeFoodName(query)
  const matchesQuery = (value: string): boolean =>
    normalizedQuery.length === 0 || normalizeFoodName(value).includes(normalizedQuery)
  const suggestions: FoodSuggestion[] = []

  for (const suggestion of recentFoods) {
    if (suggestions.length >= 6) break
    if (matchesQuery(suggestion.foodNameSnapshot)) {
      suggestions.push({
        type: 'RECENT',
        key: `recent-${suggestion.catalogCode ?? suggestion.foodNameNormalized}`,
        suggestion
      })
    }
  }
  for (const item of catalogItems) {
    if (suggestions.length >= 6) break
    if (matchesQuery(item.displayName)) {
      suggestions.push({ type: 'CATALOG', key: `catalog-${item.code}`, item })
    }
  }

  return suggestions
}
